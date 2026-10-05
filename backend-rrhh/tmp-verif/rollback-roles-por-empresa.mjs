/**
 * Rollback manual de `RolesPorEmpresa`, para dejar la base como estaba despues de una
 * ejecucion fallida a medias.
 *
 * MySQL no envuelve el DDL en transaccion: cuando esta migracion revento en el paso 3,
 * los dos ALTER ya estaban aplicados y la tabla `migrations` no la tenia registrada.
 * Reejecutarla tal cual habria fallado otra vez, porque `ADD COLUMN empresa_id` sobre una
 * columna que ya existe no es idempotente. Asi que primero se deshace y luego se corre
 * limpia.
 *
 * Usa `migration:revert` cuando la migracion SI esta registrada.
 */
import { createConnection } from 'mysql2/promise';
import 'dotenv/config';

const conexion = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

const [registrada] = await conexion.query(
  "SELECT name FROM migrations WHERE name = 'RolesPorEmpresa1790759200000'",
);
if (registrada.length > 0) {
  console.log('La migracion ya esta registrada: usa migration:revert.');
  await conexion.end();
  process.exit(0);
}

const [columnas] = await conexion.query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rol' AND COLUMN_NAME = 'empresa_id'",
);
if (columnas.length === 0) {
  console.log('La columna empresa_id no existe: no hay nada que deshacer.');
  await conexion.end();
  process.exit(0);
}

// Mismo orden que el `down()` de la migracion, por el mismo motivo: la FK de
// `usuario_empresa.rol_id` es RESTRICT y las membresias tienen que volver a las
// plantillas antes de que sus copias se borren.
await conexion.query(
  [
    'UPDATE `usuario_empresa` ue',
    'JOIN `rol` copia ON copia.`id` = ue.`rol_id`',
    'JOIN `rol` plantilla',
    '  ON plantilla.`empresa_id` IS NULL',
    '  AND plantilla.`codigo` = copia.`codigo`',
    'SET ue.`rol_id` = plantilla.`id`',
  ].join('\n'),
);
await conexion.query(
  'DELETE rp FROM `rol_permiso` rp JOIN `rol` r ON r.`id` = rp.`rol_id` WHERE r.`empresa_id` IS NOT NULL',
);
await conexion.query('DELETE FROM `rol` WHERE `empresa_id` IS NOT NULL');
await conexion.query(
  [
    'ALTER TABLE `rol`',
    'DROP INDEX `uq_rol_empresa_codigo`,',
    'DROP COLUMN `empresa_codigo_vigente`,',
    'DROP KEY `idx_rol_empresa_codigo`,',
    'DROP KEY `idx_rol_empresa`,',
    'DROP FOREIGN KEY `fk_rol_empresa`,',
    'DROP COLUMN `empresa_id`,',
    'ADD COLUMN `codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
    'ADD UNIQUE KEY `uq_rol_codigo` (`codigo_vigente`)',
  ].join('\n'),
);

const [tras] = await conexion.query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rol' AND COLUMN_NAME = 'codigo_vigente'",
);
console.log(
  tras.length === 1
    ? 'Rollback hecho: rol vuelve al esquema global.'
    : 'AVISO: el esquema no quedo como se esperaba, revisa la tabla rol.',
);
await conexion.end();
