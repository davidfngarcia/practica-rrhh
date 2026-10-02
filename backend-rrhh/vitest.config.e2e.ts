import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Carga el `.env` para las suites.
 *
 * `src/app.module.ts` llama a `configApp()` al importarse, y ese import falla sin las
 * variables en `process.env`. Se usa el cargador de Node en lugar de `dotenv/config`
 * para no depender de un paquete que solo llega de forma indirecta desde
 * `@nestjs/config`, igual que se evito con `@nestjs/mapped-types`.
 */
try {
  process.loadEnvFile();
} catch {
  // Sin `.env` no es un error: las variables pueden venir ya del entorno.
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Las suites comparten una unica base de datos: conceden permisos al rol EMPLEADO
    // y comprueban al final que se han revocado. Si dos ficheros se ejecutaran a la vez,
    // una suite veria los permisos temporales de la otra y ambos fallos serian
    // intermitentes y sin relacion con el codigo que se esta probando.
    fileParallelism: false,
    // El arranque levanta la app completa y calcula un hash bcrypt, y hay pruebas que
    // encadenan varias peticiones: los 5 s por defecto de vitest se quedan cortos.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});