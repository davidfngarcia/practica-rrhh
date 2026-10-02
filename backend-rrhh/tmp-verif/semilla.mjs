/**
 * Envoltura minima sobre la semilla de `src/database/semilla.ts`.
 *
 * La semilla vive en `src` para que la compartan este script y las suites de vitest
 * sin duplicar el SQL. Este archivo solo existe porque un `.mjs` no puede importar
 * TypeScript: se apoya en el compilado, asi que hay que ejecutar `npm run build`
 * antes si se ha tocado la semilla.
 */
import 'dotenv/config';
import {
  PASSWORD_PRUEBA,
  USUARIO_PRUEBA,
  abrirConexionDePrueba,
  asegurarDatosDePrueba,
} from '../dist/database/semilla.js';

const conexion = await abrirConexionDePrueba();

try {
  const { creados, membresias } = await asegurarDatosDePrueba(conexion);

  console.log('Datos de prueba listos.');
  console.log(`  usuario:      ${USUARIO_PRUEBA}`);
  console.log(`  password:     ${PASSWORD_PRUEBA}`);
  console.log(
    `  empresas:     ${membresias.map((m) => `${m.empresa} (${m.rol})`).join(', ')}`,
  );
  console.log(`  filas nuevas: ${creados.length}`);
} finally {
  await conexion.end();
}