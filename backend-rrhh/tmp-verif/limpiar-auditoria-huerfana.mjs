/**
 * Limpia filas de auditoria que apuntan a registros que ya no existen.
 *
 * Las pruebas de roles creaban un departamento y lo borraban con `DELETE` de SQL en vez
 * de por la API. Como la baja de un departamento es logica y auditada, ese `DELETE`
 * fisico dejo varias filas en `auditoria` con `entidad_id` sin fila correspondiente, que
 * es justo lo que comprueba `catalogos.e2e-spec.ts`.
 *
 * Es una limpieza de la base de desarrollo, no una rutina del proyecto: `auditoria` es
 * un log que solo deberia crecer, y esto existe unicamente porque un test lo hizo mal.
 *
 * Uso: node tmp-verif/limpiar-auditoria-huerfana.mjs
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

const huerfanas = [
  ['departamento', 'departamento'],
  ['puesto', 'puesto'],
  ['rol', 'rol'],
];

let total = 0;

for (const [entidad, tabla] of huerfanas) {
  const [resultado] = await conexion.query(
    `DELETE FROM auditoria
      WHERE entidad = ?
        AND entidad_id NOT IN (SELECT id FROM \`${tabla}\`)`,
    [entidad],
  );
  const afectadas = resultado?.affectedRows ?? 0;
  if (afectadas > 0) {
    console.log(`  ${entidad}: ${afectadas}`);
  }
  total += afectadas;
}

console.log(`Filas de auditoria huerfanas borradas: ${total}`);
await conexion.end();
