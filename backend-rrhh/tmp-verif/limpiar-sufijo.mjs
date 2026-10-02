/**
 * Borra lo que dejo una ejecucion interrumpida, por sufijo de codigo.
 *
 * La suite se limpia sola al terminar (seccion 9 de `catalogos.mjs`), asi que esto
 * solo hace falta cuando una ejecucion se corta a mitad y deja filas con el sufijo de
 * esa vuelta.
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const c = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
});

const sufijo = process.argv[2];
if (!sufijo) throw new Error('falta el sufijo');

const [departamentos] = await c.query(
  'SELECT id FROM departamento WHERE codigo LIKE ?',
  [`%-${sufijo}`],
);
const [puestos] = await c.query('SELECT id FROM puesto WHERE codigo LIKE ?', [
  `%-${sufijo}`,
]);

const idsDept = departamentos.map((f) => f.id);
const idsPuesto = puestos.map((f) => f.id);
const ids = [...idsDept, ...idsPuesto];

/** MySQL no admite `IN ()`: con la lista vacia no hay nada que borrar. */
async function borrarEn(sql, valores) {
  if (valores.length === 0) return;
  await c.query(sql, [valores]);
}

await borrarEn('DELETE FROM auditoria WHERE entidad_id IN (?)', ids);
await borrarEn('DELETE FROM departamento WHERE id IN (?)', idsDept);
await borrarEn('DELETE FROM puesto WHERE id IN (?)', idsPuesto);

const [[restanDept]] = await c.query(
  'SELECT COUNT(*) AS n FROM departamento WHERE codigo LIKE ?',
  [`%-${sufijo}`],
);
const [[restanPuestos]] = await c.query(
  'SELECT COUNT(*) AS n FROM puesto WHERE codigo LIKE ?',
  [`%-${sufijo}`],
);

console.log(
  `borrados ${idsDept.length} departamentos y ${idsPuesto.length} puestos; quedan ${restanDept.n} y ${restanPuestos.n}`,
);
await c.end();
