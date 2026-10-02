/**
 * Suite e2e de los catalogos: departamentos y puestos.
 *
 * Sustituye a `tmp-verif/catalogos.mjs`. Las comprobaciones son las mismas, pero como
 * `it()` de vitest: si algo falla, `npm run test:e2e` lo dice y no hace falta acordarse
 * de lanzar un script a mano.
 *
 * El usuario de prueba tiene rol RRHH en la empresa A (puede todo) y EMPLEADO en la
 * empresa B (solo lectura de empresa, persona y empleado). Esa diferencia es la que
 * permite comprobar las dos barreras por separado: permisos dentro de una empresa y
 * aislamiento entre empresas.
 *
 * Las pruebas dependen unas de otras en orden —el id del alta se reutiliza en la
 * lectura, en el aislamiento y en la auditoria—, asi que viven en un unico `describe`
 * secuencial en vez de repartirse en ficheros independientes.
 */
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS_PRUEBA,
  SUFIJO,
  borrarEn,
  borrarPorSufijo,
  conPermisosTemporales,
  consultar,
  crearAppDePrueba,
  llamar,
  prepararBase,
  tokenEmpleado,
  tokenRRHH,
} from './soporte.js';

const { empresaA } = IDS_PRUEBA;

describe('Catalogos: departamentos y puestos (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let rrhh: string;
  let empleado: string;
  let departamentoId: string;
  let puestoId: string;
  /**
   * Codigos de las filas de la empresa A, que se guardan para comprobar el aislamiento.
   * Las pruebas de multitenant comparan contra el codigo, no contra el total del listado,
   * porque el total depende de que no queden restos de otras ejecuciones.
   */
  let codigoDepartamento: string;
  let codigoPuesto: string;

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    rrhh = await tokenRRHH(app);
    empleado = await tokenEmpleado(app);
  });

  afterAll(async () => {
    // La limpieza se hace aunque una comprobacion haya fallado: si no, la siguiente
    // ejecucion encontraria codigos ocupados y fallaria por un motivo distinto al que
    // se quiere ver. `limpiar-sufijo.mjs` queda para el caso de que muera el proceso.
    const departamentos = await borrarPorSufijo(
      conexion,
      'departamento',
      SUFIJO,
    );
    const puestos = await borrarPorSufijo(conexion, 'puesto', SUFIJO);

    await borrarEn(conexion, 'DELETE FROM auditoria WHERE entidad_id IN (?)', [
      ...departamentos,
      ...puestos,
    ]);

    await conexion.end();
    await app.close();
  });

  describe('1. Proteccion y permisos', () => {
    it('sin token responde 401', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos');
      expect(respuesta.estado, respuesta.texto).toBe(401);
    });

    it('un rol sin departamento.leer recibe 403, con el permiso que falta', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos', {
        token: empleado,
      });

      expect(respuesta.estado).toBe(403);
      expect(respuesta.cuerpo?.message).toContain('departamento.leer');
    });

    it('un rol sin puesto.leer recibe 403', async () => {
      const respuesta = await llamar(app, 'GET', '/puestos', {
        token: empleado,
      });
      expect(respuesta.estado).toBe(403);
    });

    it('un rol con departamento.leer entra', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos', {
        token: rrhh,
      });
      expect(respuesta.estado).toBe(200);
    });
  });

  describe('2. Alta de departamento', () => {
    it('un alta invalida responde 400 con los campos que fallan', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo: 'con espacio', nombre: '' },
      });

      const errores = respuesta.cuerpo?.errores ?? [];
      const campos = [...new Set(errores.map((e: any) => e.campo))];

      expect(respuesta.estado, JSON.stringify(errores)).toBe(400);
      expect(campos).toContain('codigo');
      expect(campos).toContain('nombre');
    });

    it('el mensaje de formato del codigo es el escrito en el DTO, en castellano', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo: 'con espacio', nombre: '' },
      });

      const delCodigo = (respuesta.cuerpo?.errores ?? []).filter(
        (e: any) => e.campo === 'codigo',
      );

      expect(delCodigo[0]?.mensaje).toContain('empieza por una letra');
    });

    it('un codigo que empieza por guion se rechaza, como promete el mensaje', async () => {
      // El mensaje dice que el codigo no puede empezar por un guion. Si la expresion
      // regular lo admitiera, el contrato que ve el cliente y lo que se guarda
      // divergirian en silencio, asi que se comprueba que la promesa se cumple.
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo: `-DEP-${SUFIJO}`, nombre: 'Empieza por guion' },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some(
          (e: any) =>
            e.campo === 'codigo' && e.mensaje.includes('empieza por una letra'),
        ),
      ).toBe(true);
    });

    it('un guion en medio del codigo si se admite', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo: `DEPH-${SUFIJO}`, nombre: 'Guion dentro, permitido' },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
    });

    it('una propiedad no declarada en el cuerpo se rechaza', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: {
          codigo: `DEP-${SUFIJO}`,
          nombre: 'Con intruso',
          empresa_id: IDS_PRUEBA.empresaB,
        },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some((e: any) => e.campo === 'empresa_id'),
      ).toBe(true);
    });

    it('un alta valida responde 201 con el registro creado', async () => {
      const codigo = `DEP-${SUFIJO}`;
      codigoDepartamento = codigo;
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo, nombre: `Departamento de prueba ${SUFIJO}` },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
      expect(respuesta.cuerpo?.codigo).toBe(codigo);
      expect(respuesta.cuerpo?.activo).toBe(true);
      expect(respuesta.cuerpo?.descripcion).toBeNull();
      expect(typeof respuesta.cuerpo?.id).toBe('string');

      departamentoId = respuesta.cuerpo.id;
    });

    it('el alta no acepta empresa ajena: la empresa sale del token', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT empresa_id FROM departamento WHERE id = ?',
        [departamentoId],
      );

      expect(fila?.empresa_id).toBe(empresaA);
    });

    it('un codigo repetido en la misma empresa responde 409', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: { codigo: `DEP-${SUFIJO}`, nombre: 'Otro con el mismo codigo' },
      });

      expect(respuesta.estado).toBe(409);
      expect(typeof respuesta.cuerpo?.message).toBe('string');
      expect(respuesta.cuerpo.message).not.toContain('Duplicate entry');
    });

    it('el codigo se compara sin distincion de mayusculas', async () => {
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: {
          codigo: `DEP-${SUFIJO}`.toLowerCase(),
          nombre: 'Mismo codigo, otra caja',
        },
      });

      expect(respuesta.estado).toBe(409);
    });
  });

  describe('3. Lectura, busqueda y paginacion', () => {
    it('GET /departamentos/:id devuelve el registro', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos/${departamentoId}`,
        {
          token: rrhh,
        },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo?.id).toBe(departamentoId);
    });

    it('el listado responde con datos, total, pagina y por_pagina', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos', {
        token: rrhh,
      });

      const claves = Object.keys(respuesta.cuerpo ?? {})
        .sort()
        .join(',');

      expect(respuesta.estado).toBe(200);
      expect(claves).toBe('datos,pagina,por_pagina,total');
      expect(Array.isArray(respuesta.cuerpo.datos)).toBe(true);
      expect(respuesta.cuerpo.total).toBeGreaterThanOrEqual(1);
      expect(respuesta.cuerpo.pagina).toBe(1);
      expect(respuesta.cuerpo.por_pagina).toBe(20);
    });

    it('el alta aparece en el listado', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos', {
        token: rrhh,
      });

      expect(
        respuesta.cuerpo?.datos?.some((d: any) => d.id === departamentoId),
      ).toBe(true);
    });

    it('buscar por codigo en otra caja encuentra el registro', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos?buscar=${encodeURIComponent(`dep-${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.total).toBe(1);
      expect(respuesta.cuerpo?.datos?.[0]?.id).toBe(departamentoId);
    });

    it('buscar por nombre encuentra el registro', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos?buscar=${encodeURIComponent(`prueba ${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(
        respuesta.cuerpo?.datos?.some((d: any) => d.id === departamentoId),
      ).toBe(true);
    });

    it('el % se busca como texto literal y no como comodin', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos?buscar=%25', {
        token: rrhh,
      });

      expect(respuesta.cuerpo?.total).toBe(0);
    });

    it('por_pagina=1 devuelve un solo elemento y conserva el total', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos?pagina=1&por_pagina=1',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.datos).toHaveLength(1);
      expect(respuesta.cuerpo.total).toBeGreaterThanOrEqual(1);
      expect(respuesta.cuerpo.por_pagina).toBe(1);
    });

    it('una pagina mas alla del final responde vacio, no un error', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos?pagina=9999&por_pagina=1',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.datos).toHaveLength(0);
    });

    it('pagina=0 responde 400 en castellano', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos?pagina=0', {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(400);
      expect(respuesta.cuerpo?.errores?.[0]?.mensaje).toContain('empieza en 1');
    });

    it('por_pagina por encima del tope responde 400', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos?por_pagina=101',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some((e: any) =>
          e.mensaje.includes('100 elementos por pagina'),
        ),
      ).toBe(true);
    });

    it('una pagina no numerica responde 400 en castellano', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos?pagina=dos', {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(400);
      expect(typeof respuesta.cuerpo?.errores?.[0]?.mensaje).toBe('string');
    });

    it('un parametro de consulta no declarado se rechaza', async () => {
      const respuesta = await llamar(app, 'GET', '/departamentos?orden=asc', {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some(
          (e: any) =>
            e.campo === 'orden' && e.mensaje === 'no es un campo permitido',
        ),
      ).toBe(true);
    });

    it('un id que no es UUID responde 400 en castellano, no 500', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos/no-es-un-uuid',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(400);
      expect(respuesta.cuerpo?.message).toContain('no es un UUID valido');
    });

    it('un id valido pero inexistente responde 404', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos/00000000-0000-4000-8000-000000000000',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(404);
    });
  });

  describe('4. Modificacion parcial', () => {
    let id: string;

    beforeAll(async () => {
      const alta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: {
          codigo: `DEPD-${SUFIJO}`,
          nombre: `Con descripcion ${SUFIJO}`,
          descripcion: 'Descripcion que debe sobrevivir al PATCH',
        },
      });

      id = alta.cuerpo.id;
    });

    it('PATCH cambia solo el campo enviado', async () => {
      const respuesta = await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: { nombre: 'Nombre cambiado' },
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.nombre).toBe('Nombre cambiado');
      expect(respuesta.cuerpo.descripcion).toBe(
        'Descripcion que debe sobrevivir al PATCH',
      );
      expect(respuesta.cuerpo.codigo).toBe(`DEPD-${SUFIJO}`);
    });

    it('un PATCH demasiado largo responde 400 con el limite en castellano', async () => {
      const respuesta = await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: { nombre: 'x'.repeat(200) },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some((e: any) =>
          e.mensaje.includes('no puede superar los 150 caracteres'),
        ),
      ).toBe(true);
    });

    it('un PATCH sin campos se acepta y no cambia nada', async () => {
      const respuesta = await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: {},
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.nombre).toBe('Nombre cambiado');
    });

    it('cambiar a un codigo ya ocupado responde 409', async () => {
      const respuesta = await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: { codigo: `DEP-${SUFIJO}` },
      });

      expect(respuesta.estado).toBe(409);
    });

    it('PATCH activo=false responde 200', async () => {
      const respuesta = await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: { activo: false },
      });

      expect(respuesta.estado).toBe(200);
    });

    it('un departamento dado de baja desaparece del listado por defecto', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos?buscar=${SUFIJO}`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.datos?.some((d: any) => d.id === id)).toBe(
        false,
      );
    });

    it('aparece con incluir_inactivos=true', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos?buscar=${SUFIJO}&incluir_inactivos=true`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.datos?.some((d: any) => d.id === id)).toBe(true);
    });

    it('incluir_inactivos=false se interpreta como false, no como true', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos?buscar=${SUFIJO}&incluir_inactivos=false`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.datos?.some((d: any) => d.id === id)).toBe(
        false,
      );
    });

    it('un valor booleano invalido responde 400', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/departamentos?incluir_inactivos=si',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(400);
    });

    it('dar de baja con activo=false no marca deleted_at', async () => {
      await llamar(app, 'PATCH', `/departamentos/${id}`, {
        token: rrhh,
        cuerpo: { activo: true },
      });

      const [fila] = await consultar(
        conexion,
        'SELECT deleted_at, updated_by FROM departamento WHERE id = ?',
        [id],
      );

      expect(fila?.deleted_at).toBeNull();
      expect(fila?.updated_by).not.toBeNull();
    });
  });

  describe('5. Aislamiento entre empresas', () => {
    // Cada prueba concede los permisos temporales que necesita: el rol EMPLEADO no
    // los trae de serie, y asi el unico motivo posible para un 404 es la empresa y no
    // el permiso.
    it('con permiso de lectura pero de otra empresa, responde 404 y no 403', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const desdeB = await llamar(
            app,
            'GET',
            `/departamentos/${departamentoId}`,
            { token },
          );

          expect(desdeB.estado, JSON.stringify(desdeB.cuerpo)).toBe(404);
        },
      );
    });

    it('el listado de la empresa B no incluye nada de la empresa A', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const listado = await llamar(app, 'GET', '/departamentos', { token });

          expect(listado.estado).toBe(200);

          // Se comprueba que el departamento de la A no aparece, y no que el listado
          // este vacio. Lo que se quiere demostrar es el aislamiento entre empresas, y
          // "vacio" es una condicion mas fuerte que depende de que la base no tenga
          // restos de ninguna otra ejecucion: en cuanto una suite anterior deja un
          // departamento en la B, este test falla sin que el aislamiento haya cambiado.
          const codigos = (listado.cuerpo.datos ?? []).map(
            (d: { codigo: string }) => d.codigo,
          );
          expect(codigos).not.toContain(codigoDepartamento);
        },
      );
    });

    it('crear sigue exigiendo permiso de escritura: 403 aunque lea', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const respuesta = await llamar(app, 'POST', '/departamentos', {
            token,
            cuerpo: {
              codigo: `DEPB-${SUFIJO}`,
              nombre: 'Desde la otra empresa',
            },
          });

          expect(respuesta.estado).toBe(403);
        },
      );
    });

    it('modificar un recurso de otra empresa responde 403', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'PATCH',
            `/departamentos/${departamentoId}`,
            { token, cuerpo: { nombre: 'Secuestrado' } },
          );

          expect(respuesta.estado).toBe(403);
        },
      );
    });

    it('borrar un recurso de otra empresa responde 403', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'DELETE',
            `/departamentos/${departamentoId}`,
            { token },
          );

          expect(respuesta.estado).toBe(403);
        },
      );
    });

    it('ninguna de esas operaciones ajenas ha tocado la fila', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT nombre, deleted_at FROM departamento WHERE id = ?',
        [departamentoId],
      );

      expect(String(fila?.nombre)).toContain('Departamento de prueba');
      expect(fila?.deleted_at).toBeNull();
    });
  });

  describe('6. Baja logica y liberacion del codigo', () => {
    it('el registro existe antes de borrarlo', async () => {
      const filas = await consultar(
        conexion,
        'SELECT deleted_at FROM departamento WHERE id = ?',
        [departamentoId],
      );

      expect(filas).toHaveLength(1);
    });

    it('PATCH responde con el registro completo, no solo con el campo enviado', async () => {
      const respuesta = await llamar(
        app,
        'PATCH',
        `/departamentos/${departamentoId}`,
        {
          token: rrhh,
          cuerpo: { nombre: `Departamento renombrado ${SUFIJO}` },
        },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo?.nombre).toBe(
        `Departamento renombrado ${SUFIJO}`,
      );
      expect(respuesta.cuerpo?.codigo).toBe(`DEP-${SUFIJO}`);
      expect(respuesta.cuerpo?.activo).toBe(true);
      expect(typeof respuesta.cuerpo?.created_at).toBe('string');
      expect(typeof respuesta.cuerpo?.updated_at).toBe('string');
    });

    it('DELETE responde 204 sin cuerpo', async () => {
      const respuesta = await llamar(
        app,
        'DELETE',
        `/departamentos/${departamentoId}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(204);
      expect(respuesta.texto).toBe('');
    });

    it('la fila se conserva con deleted_at y activo=0', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT deleted_at, activo FROM departamento WHERE id = ?',
        [departamentoId],
      );

      expect(fila?.deleted_at).not.toBeNull();
      expect(fila?.activo).toBe(0);
    });

    it('tras la baja, el registro responde 404', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/departamentos/${departamentoId}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(404);
    });

    it('borrar dos veces el mismo id responde 404', async () => {
      const respuesta = await llamar(
        app,
        'DELETE',
        `/departamentos/${departamentoId}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(404);
    });

    it('el codigo de un departamento borrado se puede reutilizar', async () => {
      // La columna generada `codigo_vigente` vale NULL en las filas borradas, asi que el
      // codigo deberia quedar libre para reutilizar.
      const respuesta = await llamar(app, 'POST', '/departamentos', {
        token: rrhh,
        cuerpo: {
          codigo: `DEP-${SUFIJO}`,
          nombre: `Reutilizado ${SUFIJO}`,
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);

      await llamar(app, 'DELETE', `/departamentos/${respuesta.cuerpo.id}`, {
        token: rrhh,
      });
    });
  });

  describe('7. Puestos: mismo contrato que departamentos', () => {
    beforeAll(async () => {
      codigoPuesto = `PUE-${SUFIJO}`;
      const alta = await llamar(app, 'POST', '/puestos', {
        token: rrhh,
        cuerpo: {
          codigo: codigoPuesto,
          nombre: `Puesto de prueba ${SUFIJO}`,
          descripcion: 'Puesto temporal de la prueba',
        },
      });

      puestoId = alta.cuerpo?.id;
    });

    it('alta de puesto responde 201', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT codigo FROM puesto WHERE id = ?',
        [puestoId],
      );

      expect(fila?.codigo).toBe(`PUE-${SUFIJO}`);
    });

    it('incluir_inactivos=true se acepta y devuelve el listado paginado', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/puestos?incluir_inactivos=true',
        {
          token: rrhh,
        },
      );

      expect(respuesta.estado).toBe(200);
      expect(typeof respuesta.cuerpo?.total).toBe('number');
      expect(Object.keys(respuesta.cuerpo).sort().join(',')).toBe(
        'datos,pagina,por_pagina,total',
      );
    });

    it('el puesto aparece en su listado', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/puestos?incluir_inactivos=true',
        {
          token: rrhh,
        },
      );

      expect(respuesta.cuerpo?.datos?.some((p: any) => p.id === puestoId)).toBe(
        true,
      );
    });

    it('el listado de puestos filtra por busqueda', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/puestos?buscar=${encodeURIComponent(`PUE-${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.total).toBe(1);
    });

    it('PATCH de puesto responde 200 y con el registro completo', async () => {
      const respuesta = await llamar(app, 'PATCH', `/puestos/${puestoId}`, {
        token: rrhh,
        cuerpo: { activo: false },
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo?.activo).toBe(false);
      expect(respuesta.cuerpo?.codigo).toBe(`PUE-${SUFIJO}`);
      expect(respuesta.cuerpo?.descripcion).toBe(
        'Puesto temporal de la prueba',
      );
      expect(typeof respuesta.cuerpo?.created_at).toBe('string');
      expect(typeof respuesta.cuerpo?.updated_at).toBe('string');
    });

    it('sin puesto.leer, el rol de la otra empresa recibe 403 antes de mirar la fila', async () => {
      const respuesta = await llamar(app, 'GET', `/puestos/${puestoId}`, {
        token: empleado,
      });

      expect(respuesta.estado).toBe(403);
    });

    it('con puesto.leer pero desde otra empresa, el puesto responde 404', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const desdeB = await llamar(app, 'GET', `/puestos/${puestoId}`, {
            token,
          });

          expect(desdeB.estado, JSON.stringify(desdeB.cuerpo)).toBe(404);
        },
      );
    });

    it('el listado de puestos de la empresa B no ve los de la A', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['departamento.leer', 'puesto.leer'],
        async (token) => {
          const listado = await llamar(app, 'GET', '/puestos', { token });

          expect(listado.estado).toBe(200);

          // Igual que en departamentos: se comprueba que el puesto de la A no aparece, no
          // que el listado este vacio. La razon esta en el comentario de mas arriba.
          const codigos = (listado.cuerpo.datos ?? []).map(
            (p: { codigo: string }) => p.codigo,
          );
          expect(codigos).not.toContain(codigoPuesto);
        },
      );
    });

    it('DELETE de puesto responde 204', async () => {
      const respuesta = await llamar(app, 'DELETE', `/puestos/${puestoId}`, {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(204);
    });
  });

  describe('8. Auditoria de los cambios', () => {
    let eventos: Record<string, unknown>[];

    beforeAll(async () => {
      eventos = await consultar(
        conexion,
        `SELECT accion, empresa_id, datos_antes, datos_despues
           FROM auditoria
          WHERE entidad = 'departamento' AND entidad_id = ?
          ORDER BY creado_en`,
        [departamentoId],
      );
    });

    it('se auditan CREAR, ACTUALIZAR y ELIMINAR', async () => {
      const acciones = eventos.map((e) => e.accion);

      expect(acciones).toContain('CREAR');
      expect(acciones).toContain('ACTUALIZAR');
      expect(acciones).toContain('ELIMINAR');
    });

    it('la auditoria queda asociada a la empresa de la sesion', async () => {
      expect(eventos.every((e) => e.empresa_id === empresaA)).toBe(true);
    });

    it('una actualizacion guarda el estado antes y despues', async () => {
      const actualizacion = eventos.find((e) => e.accion === 'ACTUALIZAR');

      expect(actualizacion?.datos_antes).not.toBeNull();
      expect(actualizacion?.datos_despues).not.toBeNull();
      expect(
        JSON.parse(JSON.stringify(actualizacion?.datos_antes)).nombre,
      ).toBe(`Departamento de prueba ${SUFIJO}`);
    });
  });

  describe('9. Limpieza de los datos de la prueba', () => {
    // La limpieza ocurre aqui, dentro de la suite, y no solo en el `afterAll`: las
    // comprobaciones que vienen despues necesitan que las filas ya esten borradas para
    // poder afirmar que no queda auditoria huerfana. El `afterAll` repite la misma
    // operacion, que es idempotente porque vuelve a buscar por sufijo, como red de
    // seguridad si el proceso muere a mitad.
    it('borra los departamentos y puestos de la prueba', async () => {
      const departamentos = await borrarPorSufijo(
        conexion,
        'departamento',
        SUFIJO,
      );
      const puestos = await borrarPorSufijo(conexion, 'puesto', SUFIJO);

      await borrarEn(
        conexion,
        'DELETE FROM auditoria WHERE entidad_id IN (?)',
        [...departamentos, ...puestos],
      );

      // Menos dos: el `DEPH-` del formato de codigo y el `DEP-` del alta principal.
      expect(departamentos.length).toBeGreaterThanOrEqual(2);
      expect(puestos.length).toBe(1);
    });

    it('no queda auditoria apuntando a registros inexistentes', async () => {
      const [fila] = await consultar(
        conexion,
        `SELECT COUNT(*) AS n
           FROM auditoria
          WHERE entidad IN ('departamento', 'puesto')
            AND entidad_id NOT IN (SELECT id FROM departamento UNION SELECT id FROM puesto)`,
      );

      expect(Number(fila?.n)).toBe(0);
    });

    it('el rol EMPLEADO vuelve a tener solo los permisos de la semilla', async () => {
      // Si la revocacion de la seccion 5 fallara, la siguiente ejecucion empezaria con
      // la base ya tocada y las comprobaciones de permisos de la seccion 1 mentirian.
      const filas = await consultar(
        conexion,
        `SELECT p.codigo
           FROM rol_permiso rp
           JOIN rol r ON r.id = rp.rol_id
           JOIN permiso p ON p.id = rp.permiso_id
          WHERE r.codigo = 'EMPLEADO'
          ORDER BY p.codigo`,
      );

      expect(filas.map((f) => f.codigo)).toEqual([
        'empleado.leer',
        'empresa.leer',
        'persona.leer',
      ]);
    });
  });
});
