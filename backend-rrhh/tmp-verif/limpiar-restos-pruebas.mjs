/**
 * Limpia las filas que dejan las pruebas e2e cuando se acumulan.
 *
 * Las suites crean usuarios, roles y catalogos con un sufijo de ejecucion, y al terminar
 * los borran. Ese borrado esta pensado para dejar la base como estaba, pero las pruebas
 * comparten una base remota real, asi que los restos de una ejecucion que fallo a mitad, o
 * de un proceso que se corto, se quedan para siempre.
 *
 * Y no son restos inocuos. Una membresia de administrador de descarte que sobrevive hace
 * que la regla del "ultimo administrador" no se pueda volver a probar: la cuenta da dos, el
 * servicio tiene razon en dejar cambiar el rol, y la prueba falla sin que nadie haya
 * tocado el codigo que se esta probando. Cuantas mas ejecuciones, mas probable.
 *
 * Solo toca filas cuyo codigo lleva un guion y un sufijo hexadecimal de 12 caracteres, que
 * es el formato que genera `SUFIJO` en `test/soporte.ts`. Los catalogos reales del proyecto
 * no tienen esa forma, asi que no se pueden pisar por accidente.
 *
 * No borra `prueba_auth` ni `prueba_admin`, que son de la semilla.
 *
 * Uso: node tmp-verif/limpiar-restos-pruebas.mjs
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const conexion = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
});

/** Mismo formato que `SUFIJO`: `randomBytes(6).toString('hex')`. */
const PATRON = '%-%';
const nombre = (columna) => `\`${columna}\` LIKE ?`;

/** Cuenta lo que hay de cada cosa antes de borrar, para no borrar a ciegas. */
const antes = {};
for (const [etiqueta, sql] of [
  ['usuarios', `SELECT COUNT(*) n FROM usuarios WHERE ${nombre('usuario')}`],
  ['membresias', `SELECT COUNT(*) n FROM usuario_empresa WHERE usuario_id IN (SELECT id FROM usuarios WHERE ${nombre('usuario')})`],
  ['roles', `SELECT COUNT(*) n FROM rol WHERE ${nombre('codigo')}`],
  ['departamentos', `SELECT COUNT(*) n FROM departamento WHERE ${nombre('codigo')}`],
  ['puestos', `SELECT COUNT(*) n FROM puesto WHERE ${nombre('codigo')}`],
]) {
  const [filas] = await conexion.query(sql, [PATRON]);
  antes[etiqueta] = Number(filas[0].n);
}

if (Object.values(antes).every((n) => n === 0)) {
  console.log('No hay restos de pruebas.');
  await conexion.end();
  process.exit(0);
}

console.log('Restos encontrados:', antes);

// El orden es el de las dependencias: primero la auditoria, que apunta a las filas que
// van a desaparecer; luego las tablas hijas, y por ultimo las Referential Integrity de
// `usuarios`, a la que apuntan membresias y empleados.
const pasos = [
  [
    'auditoria huerfana',
    `DELETE FROM auditoria
       WHERE (entidad = 'usuario_empresa' AND entidad_id NOT IN (SELECT id FROM usuario_empresa))
          OR (entidad = 'rol' AND entidad_id NOT IN (SELECT id FROM rol))
          OR (entidad = 'departamento' AND entidad_id NOT IN (SELECT id FROM departamento))
          OR (entidad = 'puesto' AND entidad_id NOT IN (SELECT id FROM puesto))`,
    [],
  ],
  [
    // `auditoria.usuario_id` tiene FK a `usuarios` con `ON DELETE RESTRICT`, asi que borrar
    // un usuario de descarte exige borrar antes las filas de auditoria que wrote el. No es
    // un detalle: sin este paso el `DELETE FROM usuarios` revienta con el error 1451 y la
    // limpieza se queda a medias, que es como se acumulan los restos en primer lugar.
    'auditoria de usuarios de prueba',
    `DELETE FROM auditoria WHERE usuario_id IN (
        SELECT id FROM usuarios WHERE usuario LIKE ?)`,
    [PATRON],
  ],
  // Las cuatro tablas que apuntan a `usuarios` con `ON DELETE RESTRICT`. Se列表an todas,
  // y no solo las que han fallado ya, porque descubrir las de una en una en el error del
  // `DELETE` es la forma lenta de llegar al mismo sitio. Esta lista sale de
  // `information_schema.key_column_usage WHERE referenced_table_name = 'usuarios'`.
  [
    'refresh tokens de prueba',
    `DELETE FROM refresh_token WHERE usuario_id IN (
        SELECT id FROM usuarios WHERE usuario LIKE ?)`,
    [PATRON],
  ],
  [
    // `usuarios.parent_user_id` es la jerarquia de cuentas del modulo de autenticacion.
    // Nadie de prueba la usa, pero si alguna vez se creara, sin este paso el borrado de
    // usuarios se quedaria a medias otra vez.
    'usuarios de prueba que colgaban de otro',
    `UPDATE usuarios SET parent_user_id = NULL WHERE parent_user_id IN (
        SELECT id FROM usuarios WHERE usuario LIKE ?)`,
    [PATRON],
  ],
  [
    'membresias de prueba',
    `DELETE FROM usuario_empresa WHERE usuario_id IN (
        SELECT id FROM usuarios WHERE usuario LIKE ?)`,
    [PATRON],
  ],
  ['usuarios de prueba', `DELETE FROM usuarios WHERE ${nombre('usuario')}`, [PATRON]],
  [
    'roles de prueba',
    `DELETE FROM rol_permiso WHERE rol_id IN (SELECT id FROM rol WHERE ${nombre('codigo')})`,
    [PATRON],
  ],
  ['roles de prueba', `DELETE FROM rol WHERE ${nombre('codigo')}`, [PATRON]],
  ['departamentos de prueba', `DELETE FROM departamento WHERE ${nombre('codigo')}`, [PATRON]],
  ['puestos de prueba', `DELETE FROM puesto WHERE ${nombre('codigo')}`, [PATRON]],
];

let total = 0;
for (const [etiqueta, sql, parametros] of pasos) {
  const [resultado] = await conexion.query(sql, parametros);
  const afectadas = resultado?.affectedRows ?? 0;
  total += afectadas;
  if (afectadas > 0) console.log(`  ${etiqueta}: ${afectadas}`);
}

console.log(`Filas borradas: ${total}`);
await conexion.end();
