import { createHash } from 'node:crypto';
import type {
  Connection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

/**
 * SQL con dos operaciones ya normalizadas.
 *
 * Existe porque lo usan dos motores con `query` incompatible: la `Connection` de mysql2
 * devuelve `[filas, campos]`, mientras que el `QueryRunner` de TypeORM devuelve las
 * filas directamente. Atar el helper a una de las dos obligaria a castear a ciegas en
 * la otra, y ese cast fue justo lo que rompio la migracion `RolesPorEmpresa` la primera
 * vez que se ejecuto. Quien llama declara las dos con su driver y aqui solo se usa SQL.
 */
export interface EjecutorSql {
  /** Filas de un SELECT, como objetos planos. */
  consultar(sql: string, valores?: unknown[]): Promise<RowDataPacket[]>;
  /** Filas afectadas por un INSERT, UPDATE o DELETE. */
  ejecutar(sql: string, valores?: unknown[]): Promise<number>;
}

/** Adapta una `Connection` de mysql2 a `EjecutorSql`. */
export function ejecutarConMysql(conexion: Connection): EjecutorSql {
  return {
    async consultar(sql, valores) {
      const [filas] = await conexion.query(sql, valores);
      return filas as RowDataPacket[];
    },
    async ejecutar(sql, valores) {
      const [cabecera] = await conexion.query(sql, valores);
      return (cabecera as ResultSetHeader).affectedRows ?? 0;
    },
  };
}

/**
 * Copia de los roles de plantilla a una empresa nueva.
 *
 * `SeedRolesYPermisos` deja tres roles con `empresa_id IS NULL` y `es_sistema = 1`.
 * Son plantillas, no roles de nadie: existen para que cada empresa reciba las suyas al
 * crearse, y de ahi que no se puedan asignar directamente a un usuario.
 *
 * Se expone aparte de la migracion porque el alta de empresa no es una operacion de
 * tenant: la hace la plataforma, y quien la haga tiene que acordarse de esto o la
 * empresa nace sin ningun rol con el que entrar.
 *
 * Es idempotente. Se puede llamar en cada arranque sin miedo: `INSERT IGNORE` y el
 * `WHERE NOT EXISTS` hacen que una segunda pasada no cree copias duplicadas ni reviente
 * contra el unique `(empresa_id, codigo)`.
 */
export async function crearRolesPlantilla(
  sql: EjecutorSql,
  empresaId: string,
): Promise<number> {
  const plantillas = await sql.consultar(
    'SELECT `id`, `codigo`, `nombre`, `descripcion`, `activo` FROM `rol` WHERE `empresa_id` IS NULL AND `es_sistema` = 1 AND `deleted_at` IS NULL ORDER BY `codigo`',
  );

  let creados = 0;
  for (const plantilla of plantillas) {
    const id = idRolDeEmpresa(empresaId, plantilla.codigo as string);

    // Idempotencia por `NOT EXISTS`, no por `INSERT IGNORE`. `IGNORE` tambien se come
    // un choque de clave primaria, y eso es justo el fallo que hay que ver: con el
    // ignorar, dos empresas que Derivaran el mismo id dejaban a una sin roles y la
    // semilla fallaba despues con un error que no senalaba la causa.
    const affected = await sql.ejecutar(
      [
        'INSERT INTO `rol` (`id`, `empresa_id`, `codigo`, `nombre`, `descripcion`, `es_sistema`, `activo`, `created_at`, `updated_at`)',
        'SELECT ?, ?, ?, ?, ?, 1, ?, NOW(3), NOW(3) FROM DUAL',
        'WHERE NOT EXISTS (',
        '  SELECT 1 FROM `rol` WHERE `empresa_id` = ? AND `codigo` = ?',
        ')',
      ].join('\n'),
      [
        id,
        empresaId,
        plantilla.codigo,
        plantilla.nombre,
        plantilla.descripcion,
        plantilla.activo === 1 || plantilla.activo === true ? 1 : 0,
        empresaId,
        plantilla.codigo,
      ],
    );
    if (affected > 0) creados += 1;

    // Aqui `INSERT IGNORE` si procede: `rol_permiso` tiene PK (rol_id, permiso_id) y no
    // columna `deleted_at`, asi que revocar un permiso es un DELETE real y volver a
    // copiar la plantilla debe poder reinsertar el par. El unico choque posible es el
    // del propio par, que es lo que se quiere ignorar.
    await sql.ejecutar(
      [
        'INSERT IGNORE INTO `rol_permiso` (`rol_id`, `permiso_id`, `created_at`, `updated_at`)',
        'SELECT ?, rp.`permiso_id`, NOW(3), NOW(3) FROM `rol_permiso` rp WHERE rp.`rol_id` = ?',
      ].join('\n'),
      [id, plantilla.id],
    );
  }

  return creados;
}

/**
 * UUID estable de la copia de una plantilla en una empresa.
 *
 * Prefijo `d`, para que no se confunda con las `a` de permisos ni las `b` de las
 * plantillas sembradas: el `down()` de la semilla borra por prefijo `b` y no debe tocar
 * los roles de ningun tenant.
 *
 * El ultimo grupo es un hash de `empresa + codigo`, y no un trozo del id de la empresa.
 * La razon es concreta: recortar los ultimos 12 caracteres hex de la empresa devuelve
 * `000000000` tanto para `...000a` como para `...000b`, porque las dos empresas de la
 * semilla solo se diferencian en el ultimo caracter. Las dos generaban el mismo UUID, el
 * `INSERT IGNORE` se comia el choque de clave primaria en silencio, y una de las dos
 * empresas se quedaba sin roles sin dejar rastro. El hash separa las dos y no depende
 * de que el id de la empresa tenga ningun formato en concreto.
 *
 * Es determinista a proposito: un reintento tras un fallo parcial vuelve a generar el
 * mismo id, en vez de dejar una fila huerfana con un id distinto.
 */
export function idRolDeEmpresa(empresaId: string, codigoRol: string): string {
  return `d0000000-0000-4000-8000-${hash12(`${empresaId}:${codigoRol}`)}`;
}

/** SHA-256 en hexadecimal, recortado a 12 caracteres. */
function hash12(texto: string): string {
  return createHash('sha256').update(texto).digest('hex').slice(0, 12);
}
