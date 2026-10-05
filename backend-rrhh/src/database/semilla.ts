import * as bcrypt from 'bcrypt';
import { crearRolesPlantilla, ejecutarConMysql } from './plantilla-roles.js';
import {
  createConnection,
  type Connection,
  type RowDataPacket,
} from 'mysql2/promise';

/**
 * Datos de prueba para las suites de verificacion.
 *
 * Crea dos empresas y dos usuarios. `prueba_auth` es miembro de ambas con roles
 * distintos: RRHH en la A y EMPLEADO en la B. Esa diferencia es lo que permite comprobar
 * las dos barreras por separado, el permiso dentro de una empresa y el aislamiento entre
 * empresas. `prueba_admin` es `ADMIN_EMPRESA` en la A, que es el unico rol con permisos
 * `rol.*`.
 *
 * Vive en `src` y no en las suites porque lo usan dos consumidores que no comparten
 * codigo: los tests de vitest lo importan como modulo y `tmp-verif/semilla.mjs` lo
 * llama por CLI sobre el compilado. Con una sola copia, las dos rutas ven exactamente
 * los mismos datos.
 *
 * Los identificadores son fijos y todas las inserciones son idempotentes: ejecutar la
 * semilla dos veces no duplica nada. NO borra datos que ya hubiera.
 */

/** Identificadores fijos de los datos de prueba. */
export const IDS_PRUEBA = {
  usuario: 'c0000000-0000-4000-8000-000000000001',
  usuarioAdmin: 'c0000000-0000-4000-8000-000000000002',
  empresaA: 'e0000000-0000-4000-8000-00000000000a',
  empresaB: 'e0000000-0000-4000-8000-00000000000b',
  membresiaA: 'f0000000-0000-4000-8000-00000000000a',
  membresiaB: 'f0000000-0000-4000-8000-00000000000b',
  membresiaAdmin: 'f0000000-0000-4000-8000-00000000000c',
  membresiaAdminB: 'f0000000-0000-4000-8000-00000000000d',
} as const;

/**
 * Nombres de usuario con los que inician sesion las pruebas.
 *
 * Son dos y no uno porque el reparto de permisos lo exige. `prueba_auth` es RRHH, que
 * administra personal y catalogos pero NO gestiona roles: los permisos `rol.*` se
 * reservan a `ADMIN_EMPRESA`, ya que quien puede editar roles puede concederse cualquier
 * permiso o dejar a la empresa sin nadie con acceso. Con un solo usuario habria que
 * elegir entre probar la administracion de personal o la de roles, y acabar grantingos
 * `ADMIN_EMPRESA` para que las dos cosas cupieran en un token.
 */
export const USUARIO_PRUEBA = 'prueba_auth';
export const USUARIO_ADMIN_PRUEBA = 'prueba_admin';

/**
 * Password de las pruebas.
 *
 * Vive en el codigo a proposito: es una credencial de una base de desarrollo local,
 * no un secreto. Documentarla aqui evita que cada suite tenga su propia copia y que
 * una se quede sin actualizar cuando cambie.
 */
export const PASSWORD_PRUEBA = 'Auth-de-prueba-2026';

/** Membresia del usuario de prueba, tal y como queda tras la semilla. */
export interface MembresiaPrueba {
  empresa: string;
  rol: string;
  activo: number;
}

/** Resultado de `asegurarDatosDePrueba()`. */
export interface ResultadoSemilla {
  /** Descripciones de las filas creadas en esta ejecucion; vacio si ya existian. */
  creados: string[];
  membresias: MembresiaPrueba[];
}

/**
 * Carga `.env` si existe.
 *
 * Cuando este modulo lo importa vitest, el `vitest.config.e2e.ts` ya lo ha cargado y
 * el entorno esta listo. La CLI (`npm run semilla`) no pasa por ahi, y sin esto
 * `DB_HOST` llegaria vacio y la conexion fallaria contra `localhost`. Solo se intenta si
 * el fichero esta: en produccion las variables llegan por el entorno y no hay nada que
 * leer.
 */
function cargarEntornoSiHaceFalta(): void {
  if (process.env.DB_HOST) return;

  try {
    process.loadEnvFile();
  } catch {
    // Sin `.env` se sigue adelante: la configuracion puede venir del entorno.
  }
}

/** Abre una conexion con la configuracion del entorno. */
export function abrirConexionDePrueba(): Promise<Connection> {
  cargarEntornoSiHaceFalta();

  return createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: { rejectUnauthorized: false },
  });
}

/**
 * Inserta la fila si no existe. Devuelve la descripcion de lo creado, o `null` si ya
 * estaba.
 */
/**
 * Roles de una empresa, indexados por codigo.
 *
 * Los roles de plantilla (`empresa_id IS NULL`) quedan fuera a proposito: no son de
 * esta empresa, y asignarle uno a un usuario seria darle un rol que no existe en su
 * tenant.
 */
async function rolesDeEmpresa(
  conexion: Connection,
  empresaId: string,
): Promise<Record<string, string>> {
  const [roles] = await conexion.query<RowDataPacket[]>(
    'SELECT `id`, `codigo` FROM `rol` WHERE `empresa_id` = ? AND `deleted_at` IS NULL',
    [empresaId],
  );
  const porCodigo: Record<string, string> = {};
  for (const rol of roles) porCodigo[rol.codigo as string] = rol.id as string;
  return porCodigo;
}

async function insertarSiFalta(
  conexion: Connection,
  descripcion: string,
  sql: string,
  valores: unknown[],
  condicion: { tabla: string; donde: string },
  parametrosCondicion: unknown[] = [],
): Promise<string | null> {
  const [existentes] = await conexion.query<RowDataPacket[]>(
    `SELECT 1 FROM ${condicion.tabla} WHERE ${condicion.donde} LIMIT 1`,
    parametrosCondicion,
  );

  if (existentes.length > 0) return null;

  await conexion.query(sql, valores);
  return descripcion;
}

/** Asegura que existan las empresas, el usuario y las membresias de prueba. */
export async function asegurarDatosDePrueba(
  conexion: Connection,
): Promise<ResultadoSemilla> {
  const creados: (string | null)[] = [];
  const hash = await bcrypt.hash(PASSWORD_PRUEBA, 10);

  // Usuario: rol RRHH en la empresa A y solo lectura en la B.
  creados.push(
    await insertarSiFalta(
      conexion,
      'usuario prueba_auth',
      `INSERT INTO usuarios (id, usuario, password_hash, email, activo, created_at, updated_at)
       VALUES (?, ?, ?, 'prueba_auth@ejemplo.local', 1, NOW(3), NOW(3))`,
      [IDS_PRUEBA.usuario, USUARIO_PRUEBA, hash],
      { tabla: '`usuarios`', donde: '`id` = ?' },
      [IDS_PRUEBA.usuario],
    ),
  );

  // Usuario administrador de la empresa A. Es el que tiene `rol.*`, y por eso las
  // pruebas de la API de roles inician sesion con el.
  //
  // `usuario` es UNIQUE en toda la tabla, no por empresa: es la identidad global de la
  // persona, y lo que se reparte por empresa son las membresias. Por eso hace falta una
  // segunda fila y no una segunda membresia del mismo usuario en la misma empresa, que
  // choca con `uq_membresia_empresa_usuario`.
  creados.push(
    await insertarSiFalta(
      conexion,
      'usuario prueba_admin',
      `INSERT INTO usuarios (id, usuario, password_hash, email, activo, created_at, updated_at)
       VALUES (?, ?, ?, 'prueba_admin@ejemplo.local', 1, NOW(3), NOW(3))`,
      [IDS_PRUEBA.usuarioAdmin, USUARIO_ADMIN_PRUEBA, hash],
      { tabla: '`usuarios`', donde: '`id` = ?' },
      [IDS_PRUEBA.usuarioAdmin],
    ),
  );

  // El hash se regenera en cada ejecucion (bcrypt aplica sal aleatoria), asi que se
  // fija despues para que la password documentada siga siendo la valida.
  await conexion.query(
    'UPDATE usuarios SET password_hash = ? WHERE id IN (?, ?)',
    [hash, IDS_PRUEBA.usuario, IDS_PRUEBA.usuarioAdmin],
  );

  // Cada empresa recibe una copia de los roles de plantilla. Va justo despues de
  // crearla: `crearRolesPlantilla` necesita una empresa que ya exista para poder
  // apuntarle la FK, y sin esos roles la empresa nace sin forma de asignarle un rol a
  // nadie, con lo que el usuario no podria autenticarse en ella.
  const rolesPorEmpresa = new Map<string, Record<string, string>>();

  for (const [id, codigo, nombre] of [
    [IDS_PRUEBA.empresaA, 'PRUEBA_A', 'Empresa de Prueba A'],
    [IDS_PRUEBA.empresaB, 'PRUEBA_B', 'Empresa de Prueba B'],
  ]) {
    creados.push(
      await insertarSiFalta(
        conexion,
        `empresa ${nombre}`,
        `INSERT INTO empresa (id, codigo, nombre, activo, created_at, updated_at)
         VALUES (?, ?, ?, 1, NOW(3), NOW(3))`,
        [id, codigo, nombre],
        { tabla: '`empresa`', donde: '`id` = ?' },
        [id],
      ),
    );

    await conexion.query(
      'UPDATE empresa SET codigo = ?, nombre = ?, activo = 1 WHERE id = ?',
      [codigo, nombre, id],
    );

    await crearRolesPlantilla(ejecutarConMysql(conexion), id as string);
    rolesPorEmpresa.set(
      id as string,
      await rolesDeEmpresa(conexion, id as string),
    );
  }

  for (const [id, empresaId, usuarioId, rolCodigo] of [
    [IDS_PRUEBA.membresiaA, IDS_PRUEBA.empresaA, IDS_PRUEBA.usuario, 'RRHH'],
    [
      IDS_PRUEBA.membresiaB,
      IDS_PRUEBA.empresaB,
      IDS_PRUEBA.usuario,
      'EMPLEADO',
    ],
    [
      IDS_PRUEBA.membresiaAdmin,
      IDS_PRUEBA.empresaA,
      IDS_PRUEBA.usuarioAdmin,
      'ADMIN_EMPRESA',
    ],
    // El administrador tambien esta en la B, para que las pruebas puedan escribir en las
    // dos empresas con el mismo usuario y comprobar el aislamiento sin que el 403 por
    // permisos se confunda con el 404 por tenant.
    [
      IDS_PRUEBA.membresiaAdminB,
      IDS_PRUEBA.empresaB,
      IDS_PRUEBA.usuarioAdmin,
      'ADMIN_EMPRESA',
    ],
  ]) {
    // Se busca el rol DENTRO de la empresa. Antes de que los roles fueran por empresa,
    // `SELECT id FROM rol WHERE codigo = ?` bastaba; con roles por empresa ese select
    // devuelve tres filas y el rol de la empresa A terminaria siendo el de la B.
    const rolId = rolesPorEmpresa.get(empresaId as string)?.[
      rolCodigo as string
    ];
    if (!rolId) {
      throw new Error(
        `Falta el rol ${rolCodigo} en ${empresaId}: ejecuta las migraciones antes de la semilla`,
      );
    }

    creados.push(
      await insertarSiFalta(
        conexion,
        `membresia ${rolCodigo}`,
        `INSERT INTO usuario_empresa (id, empresa_id, usuario_id, rol_id, activo, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, NOW(3), NOW(3))`,
        [id, empresaId, usuarioId, rolId],
        { tabla: '`usuario_empresa`', donde: '`id` = ?' },
        [id],
      ),
    );

    await conexion.query(
      'UPDATE usuario_empresa SET empresa_id = ?, usuario_id = ?, rol_id = ?, activo = 1 WHERE id = ?',
      [empresaId, usuarioId, rolId, id],
    );
  }

  const [membresias] = await conexion.query<RowDataPacket[]>(
    `SELECT e.nombre AS empresa, r.codigo AS rol, ue.activo
       FROM usuario_empresa ue
       JOIN empresa e ON e.id = ue.empresa_id
       JOIN rol r ON r.id = ue.rol_id
      WHERE ue.usuario_id = ?
      ORDER BY e.nombre`,
    [IDS_PRUEBA.usuario],
  );

  return {
    creados: creados.filter((c): c is string => c !== null),
    membresias: membresias as unknown as MembresiaPrueba[],
  };
}

/**
 * Se ejecuta solo como programa: `node dist/database/semilla.js`.
 *
 * La comparacion con el final del nombre del script distingue este caso del import
 * desde una suite, que no debe imprimir nada ni abrir su propia conexion.
 */
async function main(): Promise<void> {
  const conexion = await abrirConexionDePrueba();

  try {
    const { creados, membresias } = await asegurarDatosDePrueba(conexion);

    console.log('Datos de prueba listos.');
    console.log(`  usuario:      ${USUARIO_PRUEBA}`);
    console.log(`  administrador: ${USUARIO_ADMIN_PRUEBA}`);
    console.log(`  password:     ${PASSWORD_PRUEBA}`);
    console.log(
      `  empresas:     ${membresias.map((m) => `${m.empresa} (${m.rol})`).join(', ')}`,
    );
    console.log(`  filas nuevas: ${creados.length}`);
  } finally {
    await conexion.end();
  }
}

if (process.argv[1]?.endsWith('semilla.js')) {
  main().catch((error: unknown) => {
    console.error('Error al preparar los datos de prueba:', error);
    process.exit(1);
  });
}
