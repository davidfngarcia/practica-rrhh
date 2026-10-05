/**
 * Consulta puntual contra la base de desarrollo.
 *
 * Evita pelearse con las comillas de PowerShell a la hora de pasar SQL en linea.
 *
 * Uso: node tmp-verif/consulta.mjs "SELECT codigo FROM permiso WHERE modulo = 'usuario'"
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';

const sql = process.argv[2];
if (!sql) throw new Error('falta la consulta');

const conexion = await createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
});

const [filas] = await conexion.query(sql);
console.log(JSON.stringify(filas, null, 2));

await conexion.end();
