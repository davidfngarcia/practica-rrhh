import { createConnection } from "mysql2/promise";
import "dotenv/config";
const c = await createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USERNAME,password:process.env.DB_PASSWORD,database:process.env.DB_DATABASE});
const [rows] = await c.query(`SELECT e.codigo AS empresa, r.codigo AS rol, p.codigo AS permiso
  FROM rol_permiso rp JOIN rol r ON r.id=rp.rol_id JOIN permiso p ON p.id=rp.permiso_id
  LEFT JOIN empresa e ON e.id=r.empresa_id
  WHERE r.codigo='EMPLEADO' AND r.empresa_id IS NOT NULL ORDER BY e.codigo, p.codigo`);
const por = {};
for (const x of rows) { por[`${x.empresa}:${x.rol}`] ??= []; por[`${x.empresa}:${x.rol}`].push(x.permiso); }
for (const [k,v] of Object.entries(por)) console.log(k, "->", v.length, v.join(","));
await c.end();
