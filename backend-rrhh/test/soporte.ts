/**
 * Utilidades compartidas por las suites e2e.
 *
 * No es un spec: vitest solo recoge los ficheros `*.e2e-spec.ts`, asi que este vive
 * aparte y se importa desde las suites.
 *
 * Lo importante es que la app de prueba se monta con las mismas piezas que `main.ts`
 * (parser de cuerpo, pipe de validacion y filtro de errores). Si la suite usara una
 * reconstruccion, un cambio que rompiera la traduccion de errores pasaria los tests
 * y llegaria a produccion: lo que se prueba es lo que arranca.
 */
import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { Connection } from 'mysql2/promise';
import { rutaApi } from '../src/common/prefijo.js';
import {
  IDS_PRUEBA,
  PASSWORD_PRUEBA,
  USUARIO_PRUEBA,
  abrirConexionDePrueba,
  asegurarDatosDePrueba,
} from '../src/database/semilla.js';

export { IDS_PRUEBA };

/**
 * Sufijo unico por ejecucion.
 *
 * Los codigos de prueba llevan este sufijo para poder distinguir sus propias filas y
 * borrarlas al terminar, sin tocar datos de otra ejecucion ni de otros entornos.
 */
export const SUFIJO = process.env.SUFIJO ?? randomBytes(6).toString('hex');

/**
 * Levanta la aplicacion como lo hace `main.ts`.
 *
 * `AppModule` valida la configuracion al importarse y `configApp()` la cachea, asi que
 * los limites de peticiones tienen que estar puestos ANTES de ese import. Por eso el
 * import es dinamico: un `import` estatico en la cabecera se evaluaria antes de las
 * asignaciones de este modulo.
 */
export async function crearAppDePrueba(): Promise<INestApplication> {
  // La suite hace decenas de peticiones seguidas, muy por encima de los limites de
  // produccion. Se fijan aqui, y no con `??=`, para que el resultado no dependa de si
  // el `.env` del desarrollador declara o no un limite de pruebas.
  process.env.THROTTLE_LOGIN = '500';
  process.env.THROTTLE_GLOBAL = '2000';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { configurarCuerpoJson } = await import('../src/common/cuerpo.js');
  const { FiltroErrores, pipeValidacion } =
    await import('../src/common/errores.js');
  const { configurarPrefijo } = await import('../src/common/prefijo.js');

  const app = await NestFactory.create(AppModule, {
    logger: false,
    // Imprescindible: el parser de Nest se registraria antes que el de `cuerpo.ts` y
    // los errores de JSON mal formado volverian a salir en ingles.
    bodyParser: false,
  });

  configurarCuerpoJson(app);
  app.useGlobalPipes(pipeValidacion());
  app.useGlobalFilters(new FiltroErrores());
  configurarPrefijo(app);

  await app.init();
  return app;
}

/** Conexion propia a la base, para comprobar el estado real de las filas. */
export function abrirConexion(): Promise<Connection> {
  return abrirConexionDePrueba();
}

/** Ejecuta una consulta y devuelve las filas. */
export async function consultar(
  conexion: Connection,
  sql: string,
  parametros: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const [filas] = await conexion.query(sql, parametros);
  return filas as Record<string, unknown>[];
}

/**
 * Ejecuta un `DELETE ... IN (?)` sin romperse con la lista vacia.
 *
 * MySQL no admite `IN ()`, y borrar cero filas es el caso normal de una prueba
 * limpia, no un error.
 */
export async function borrarEn(
  conexion: Connection,
  sql: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;

  const [resultado] = await conexion.query(sql, [ids]);
  const cabecera = resultado as { affectedRows?: number };
  return cabecera.affectedRows ?? 0;
}

/** Token de acceso del usuario de prueba en la empresa indicada. */
export async function iniciarSesion(
  app: INestApplication,
  empresaId: string,
): Promise<string> {
  const respuesta = await request(app.getHttpServer())
    .post(rutaApi('/auth/login'))
    .send({
      usuario: USUARIO_PRUEBA,
      password: PASSWORD_PRUEBA,
      empresa_id: empresaId,
    });

  if (respuesta.status !== 200) {
    throw new Error(
      `No se pudo iniciar sesion en ${empresaId}: ${respuesta.status} ${JSON.stringify(respuesta.body)}`,
    );
  }

  return respuesta.body.access_token as string;
}

/** Token con el rol RRHH, que es el que puede escribir en los catalogos. */
export function tokenRRHH(app: INestApplication): Promise<string> {
  return iniciarSesion(app, IDS_PRUEBA.empresaA);
}

/**
 * Token con el rol EMPLEADO de la empresa B.
 *
 * Solo tiene `empresa.leer`, `persona.leer` y `empleado.leer`, asi que sirve para
 * comprobar que los catalogos le negan el paso con 403.
 */
export function tokenEmpleado(app: INestApplication): Promise<string> {
  return iniciarSesion(app, IDS_PRUEBA.empresaB);
}

/**
 * Prepara la base para la suite y devuelve la conexion con la que limpiara al final.
 *
 * La semilla se ejecuta aqui y no en un script aparte porque asi `npm run test:e2e`
 * no depende de que alguien recuerde lanzar `tmp-verif/semilla.mjs` antes.
 */
export async function prepararBase(): Promise<Connection> {
  const conexion = await abrirConexionDePrueba();
  await asegurarDatosDePrueba(conexion);
  return conexion;
}

/**
 * Respuesta de una peticion, con el cuerpo ya interpretado.
 *
 * `cuerpo` es `any` a proposito: las comprobaciones de estas suites leen campos sueltos
 * del JSON y tiparlos uno por uno no aporta nada; lo que se comprueba es el estado y la
 * forma, que es justo lo que el tipado debil dejaria pasar sin querer.
 */
export interface RespuestaPeticion {
  estado: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cuerpo: any;
  /** Cuerpo en crudo, para comprobar que un 204 no devuelve nada. */
  texto: string;
}

/** Metodos HTTP usados por las suites. */
type Metodo = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * Ejecuta una peticion HTTP contra la app de prueba.
 *
 * Envuelve supertest para devolver siempre los tres campos juntos. El cuerpo se
 * interpreta a mano, igual que la respuesta cruda, porque un error de Nest puede
 * responder con texto plano y las comparaciones necesitan el objeto.
 *
 * `ruta` va sin prefijo: lo anade `rutaApi`, la misma funcion que usa `main.ts`.
 */
export async function llamar(
  app: INestApplication,
  metodo: Metodo,
  ruta: string,
  opciones: { token?: string; cuerpo?: unknown } = {},
): Promise<RespuestaPeticion> {
  const servidor = app.getHttpServer();
  const completa = rutaApi(ruta);

  // supertest tipa cada metodo por separado y no admite indexar por nombre, asi que se
  // escribe el `switch` en vez de `request(servidor)[metodo](ruta)`.
  const peticion = (() => {
    switch (metodo) {
      case 'GET':
        return request(servidor).get(completa);
      case 'POST':
        return request(servidor).post(completa);
      case 'PATCH':
        return request(servidor).patch(completa);
      case 'DELETE':
        return request(servidor).delete(completa);
    }
  })();

  if (opciones.token) peticion.set('authorization', `Bearer ${opciones.token}`);
  if (opciones.cuerpo !== undefined) {
    peticion
      .set('content-type', 'application/json')
      .send(opciones.cuerpo as object);
  }

  const respuesta = await peticion;

  let cuerpo: RespuestaPeticion['cuerpo'] = respuesta.text;
  try {
    cuerpo = JSON.parse(respuesta.text);
  } catch {
    /* respuesta no-JSON: se deja el texto plano */
  }

  return { estado: respuesta.status, cuerpo, texto: respuesta.text };
}

/**
 * Ejecuta `prueba` con permisos concedidos temporalmente al rol EMPLEADO.
 *
 * El rol EMPLEADO solo trae `empresa.leer`, `persona.leer` y `empleado.leer`, asi que el
 * guard de permisos responderia 403 antes de llegar al filtro por empresa. Para poder
 * mirar la barrera de multitenant por separado se conceden los permisos pedidos, se
 * vuelve a iniciar sesion —los permisos se releen en cada peticion, por eso hace falta
 * un token nuevo— y al terminar se revoca solo lo que esta ejecucion concedio,
 * dejando la semilla como estaba.
 */
export async function conPermisosTemporales(
  conexion: Connection,
  app: INestApplication,
  codigos: string[],
  prueba: (token: string) => Promise<void>,
): Promise<void> {
  const [rolEmpleado] = await consultar(
    conexion,
    "SELECT id FROM rol WHERE codigo = 'EMPLEADO'",
  );
  if (!rolEmpleado) throw new Error('No existe el rol EMPLEADO');

  const concedidos: string[] = [];

  for (const codigo of codigos) {
    const [permiso] = await consultar(
      conexion,
      'SELECT id FROM permiso WHERE codigo = ?',
      [codigo],
    );
    if (!permiso) throw new Error(`No existe el permiso ${codigo}`);

    // `query()` devuelve `[resultado, campos]`. En un INSERT lo que dice cuantas filas
    // tocaron es el primer elemento, y el segundo viene undefined porque no hay
    // columnas que devolver. Destructurar `{ affectedRows }` sobre el array daria
    // `undefined`, la lista de concedidos se quedaria vacia y los permisos se
    // quedarian colgados en la base entre ejecuciones.
    const [resultado] = await conexion.query(
      'INSERT IGNORE INTO rol_permiso (rol_id, permiso_id) VALUES (?, ?)',
      [rolEmpleado.id, permiso.id],
    );
    const cabecera = resultado as { affectedRows?: number };
    if ((cabecera.affectedRows ?? 0) > 0) concedidos.push(codigo);
  }

  try {
    const token = await iniciarSesion(app, IDS_PRUEBA.empresaB);
    await prueba(token);
  } finally {
    for (const codigo of concedidos) {
      await conexion.query(
        `DELETE rp FROM rol_permiso rp
           JOIN permiso p ON p.id = rp.permiso_id
          WHERE rp.rol_id = ? AND p.codigo = ?`,
        [rolEmpleado.id, codigo],
      );
    }
  }
}

/**
 * Filas creadas por esta ejecucion, para borrarlas al terminar.
 *
 * Antes se localizaban por `numero_documento LIKE '%-<sufijo>'`, y eso dejo de funcionar
 * al cifrarse el documento: el LIKE se ejecutaba contra texto cifrado y no encontraba
 * nada, asi que la limpieza se creia haber borrado cero filas y el borrado siguiente
 * reventaba por la FK.
 *
 * Registrar los ids que devuelve la API evita el problema de raiz. Las pruebas ya
 * necesitan el id de cada fila para consultarla, asi que no hay nada nuevo que aprender,
 * y la limpieza deja de depender de como se guardan las columnas: si manana el documento
 * se cifra con otro algoritmo o se deja de guardar, estas suites no se enteran.
 */
const personasCreadas = new Set<string>();
const empleadosCreados = new Set<string>();

/** Anota una persona creada por la suite para borrarla en la limpieza. */
export function registrarPersona(id: string): void {
  if (id) personasCreadas.add(id);
}

/** Anota un empleado creado por la suite para borrarlo en la limpieza. */
export function registrarEmpleado(id: string): void {
  if (id) empleadosCreados.add(id);
}

/** Ids de las personas que esta ejecucion ha creado. */
export function idsDePersonasCreadas(): string[] {
  return [...personasCreadas];
}

/** Ids de los empleados que esta ejecucion ha creado. */
export function idsDeEmpleadosCreados(): string[] {
  return [...empleadosCreados];
}

/**
 * Borra las filas de la prueba de una tabla, buscando por codigo con el sufijo.
 *
 * Devuelve los ids que ha borrado, para poder limpiar despues la auditoria asociada.
 */
export async function borrarPorSufijo(
  conexion: Connection,
  tabla: 'departamento' | 'puesto',
  sufijo: string,
): Promise<string[]> {
  const filas = await consultar(
    conexion,
    `SELECT id FROM ${tabla} WHERE codigo LIKE ?`,
    [`%-${sufijo}`],
  );
  const ids = filas.map((f) => f.id as string);

  await borrarEn(conexion, `DELETE FROM ${tabla} WHERE id IN (?)`, ids);
  return ids;
}
