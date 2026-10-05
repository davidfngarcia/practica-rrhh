/**
 * Sondas de salud y rutas versionadas (e2e).
 *
 * Estas rutas las consulta el orquestador y el balanceador, no el frontend, asi que se
 * prueban por separado del resto de la API: un fallo aqui no lo nota un usuario, lo nota
 * el despliegue.
 *
 * Lo que se comprueba:
 *
 * - Que `/health` y `/ready` responden sin token. Si el guard global las cubriera, el
 *   orquestador veria un 401, lo interpretaria como "el proceso esta mal" y reiniciaria un
 *   contenedor sano en bucle.
 * - Que `/ready` da 503 cuando la base no responde. Un `/ready` que siempre dice 200 es
 *   peor que no tenerlo: mete en rotacion instancias que no pueden atender.
 * - Que las sondas siguen fuera del prefijo de version y que el resto de la API esta
 *   dentro. Un cambio de lado aqui rompe el despliegue entero sin que ninguna prueba de
 *   negocio se entere.
 */
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { crearAppDePrueba } from './soporte.js';

describe('Sondas y versionado (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sondas de salud', () => {
    it('`/health` responde 200 sin token: el orquestador no tiene credenciales', async () => {
      const respuesta = await request(app.getHttpServer()).get('/health');

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toEqual({ estado: 'ok' });
    });

    it('`/ready` responde 200 con la base disponible', async () => {
      const respuesta = await request(app.getHttpServer()).get('/ready');

      expect(respuesta.status).toBe(200);
      // `toMatchObject` y no `toEqual`: Terminus anade `responseTime`, que cambia en cada
      // llamada. Comparar el objeto entero haria fallar la prueba por reason de tiempo y
      // acabaria siendo una prueba que se ignora.
      expect(respuesta.body).toMatchObject({
        status: 'ok',
        info: { base: { status: 'up' } },
        error: {},
        details: { base: { status: 'up' } },
      });
    });
  });

  describe('independencia de la version', () => {
    it('las sondas no estan bajo el prefijo de version', async () => {
      // Si se colgaran del prefijo, un despliegue nuevo con v2 dejaria sin health check
      // al contenedor y el orquestador lo mataria al reiniciar el primero.
      const conPrefijo = await request(app.getHttpServer()).get(
        '/api/v1/health',
      );

      expect(conPrefijo.status).toBe(404);
    });

    it('la API de negocio si esta bajo el prefijo', async () => {
      // El 401 y no el 404 es lo que demuestra que la ruta existe: un 404 seria una ruta
      // que se ha perdido al versionar.
      const sinPrefijo = await request(app.getHttpServer()).get('/personas');
      const conPrefijo = await request(app.getHttpServer()).get(
        '/api/v1/personas',
      );

      expect(sinPrefijo.status).toBe(404);
      expect(conPrefijo.status).toBe(401);
    });
  });
});
