/**
 * Empresa de la sesion (e2e).
 *
 * Lo que se prueba aqui no es el CRUD en si, sino que las rutas de empresa **no** tienen
 * las que tendria un CRUD normal, y por que. Un endpoint que devuelve la empresa propia
 * y nada mas no parece un endpoint incompleto, parece una decision, y una prueba es lo
 * que deja constancia de esa decision para que nadie la lea como un olvido.
 */
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  abrirConexion,
  conPermisosTemporales,
  crearAppDePrueba,
  iniciarSesion,
  llamar,
  prepararBase,
} from './soporte.js';
import { IDS_PRUEBA } from '../src/database/semilla.js';

const { empresaA } = IDS_PRUEBA;

describe('Empresa de la sesion (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let rrhh: string;

  beforeAll(async () => {
    await prepararBase();
    app = await crearAppDePrueba();
    conexion = await abrirConexion();
    rrhh = await iniciarSesion(app, empresaA);
  });

  afterAll(async () => {
    await app.close();
    await conexion.end();
  });

  it('devuelve la empresa del token, sin que el cliente pueda pedir otra', async () => {
    const respuesta = await llamar(app, 'GET', '/empresa', { token: rrhh });

    expect(respuesta.estado).toBe(200);
    expect((respuesta.cuerpo as { id: string }).id).toBe(empresaA);
  });

  it('NO existe un listado de empresas', async () => {
    // Un `GET /empresas` que devolviera todos los tenants del cliente seria una fuga de
    // la lista de empresas cliente. El 404 es la respuesta correcta.
    const respuesta = await llamar(app, 'GET', '/empresas', { token: rrhh });

    expect(respuesta.estado).toBe(404);
  });

  it('NO existe un alta de empresa', async () => {
    // Si existiera, cualquier usuario autenticado podria crear una empresa y autenticarse
    // en ella como su propio ADMIN_EMPRESA.
    const respuesta = await llamar(app, 'POST', '/empresa', {
      token: rrhh,
      cuerpo: { codigo: 'NUEVA', nombre: 'Nueva' },
    });

    expect(respuesta.estado).toBe(404);
  });

  it('rechaza `empresa_id` en el cuerpo del PATCH con 400', async () => {
    // Se necesita `empresa.actualizar`: con el rol RRHH de la semilla el 403 saltaria
    // antes que la validacion, y la prueba pasaria sin comprobar nada del cuerpo.
    await conPermisosTemporales(
      conexion,
      app,
      ['empresa.leer', 'empresa.actualizar'],
      async (token) => {
        // El pipe va con `forbidNonWhitelisted`, asi que una propiedad no declarada se
        // rechaza en vez de ignorarse. Importa que sea un rechazo explicito y no un
        // silencio: si se ignorara, un cliente que creyera estar cambiando de empresa
        // recibiria un 200 y creeria que lo ha hecho.
        const antes = await llamar(app, 'GET', '/empresa', { token });

        const respuesta = await llamar(app, 'PATCH', '/empresa', {
          token,
          cuerpo: {
            nombre_comercial: 'Comercial de prueba',
            empresa_id: 'AJENA',
          } as never,
        });

        expect(respuesta.estado).toBe(400);
        expect(JSON.stringify(respuesta.cuerpo)).toContain('empresa_id');

        // Y la empresa sigue siendo la del token, sin cambios. Se compara contra la
        // empresa que devuelve el propio `antes` y no contra una constante: el helper
        // puede abrir la sesion en cualquiera de las empresas de pruebas, y la
        // comparacion que importa es que no ha cambiado.
        const despues = await llamar(app, 'GET', '/empresa', { token });
        expect((despues.cuerpo as { id: string }).id).toBe(
          (antes.cuerpo as { id: string }).id,
        );
        expect(
          (despues.cuerpo as { nombre_comercial: string }).nombre_comercial,
        ).toBe((antes.cuerpo as { nombre_comercial: string }).nombre_comercial);
      },
    );
  });

  it('no deja cambiar `codigo` ni `identificacion_tributaria`', async () => {
    const antes = await llamar(app, 'GET', '/empresa', { token: rrhh });

    await llamar(app, 'PATCH', '/empresa', {
      token: rrhh,
      cuerpo: { codigo: 'CAMBIADO', identificacion_tributaria: '999' } as never,
    });

    const despues = await llamar(app, 'GET', '/empresa', { token: rrhh });
    expect((despues.cuerpo as { codigo: string }).codigo).toBe(
      (antes.cuerpo as { codigo: string }).codigo,
    );
    expect(
      (despues.cuerpo as { identificacion_tributaria: string })
        .identificacion_tributaria,
    ).toBe(
      (antes.cuerpo as { identificacion_tributaria: string })
        .identificacion_tributaria,
    );
  });

  it('sin `empresa.actualizar` el PATCH es 403', async () => {
    await conPermisosTemporales(
      conexion,
      app,
      ['empresa.leer'],
      async (token) => {
        const lectura = await llamar(app, 'GET', '/empresa', { token });
        const escritura = await llamar(app, 'PATCH', '/empresa', {
          token,
          cuerpo: { telefono: '600000000' },
        });

        expect(lectura.estado).toBe(200);
        expect(escritura.estado).toBe(403);
      },
    );
  });

  it('sin token es 401, no 404', async () => {
    // El 401 y no el 404 demuestra que la ruta existe y lo que falta son las credenciales.
    const respuesta = await llamar(app, 'GET', '/empresa');

    expect(respuesta.estado).toBe(401);
  });
});
