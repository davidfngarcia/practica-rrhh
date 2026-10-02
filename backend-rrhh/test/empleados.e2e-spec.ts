/**
 * Suite e2e de empleados.
 *
 * Aqui esta la parte del modelo que no se puede copiar de los catalogos: el empleado es
 * el cruce entre un catalogo global (`persona`) y dos catalogos de empresa
 * (`departamento`, `puesto`), con FKs compuestas que obligan a que las tres referencias
 * sean coherentes. La suite comprueba justo eso, ademas del aislamiento entre empresas.
 */
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS_PRUEBA,
  SUFIJO,
  borrarEn,
  conPermisosTemporales,
  consultar,
  crearAppDePrueba,
  idsDeEmpleadosCreados,
  idsDePersonasCreadas,
  llamar,
  prepararBase,
  registrarEmpleado,
  registrarPersona,
  tokenRRHH,
} from './soporte.js';

const { empresaA, empresaB } = IDS_PRUEBA;

describe('Empleados (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let rrhh: string;

  let personaId: string;
  let departamentoId: string;
  let puestoId: string;
  let empleadoId: string;
  /** Persona que queda con un empleado vivo, para probar que no se puede dar de baja. */
  let personaConEmpleadoId: string;

  /** Crea una persona de la prueba y devuelve su id. */
  async function crearPersona(marca: string): Promise<string> {
    const respuesta = await llamar(app, 'POST', '/personas', {
      token: rrhh,
      cuerpo: {
        tipo_documento: 'CC',
        numero_documento: `CC-${marca}-${SUFIJO}`,
        nombres: `Nombre ${marca}`,
        apellidos: `Apellido ${SUFIJO}`,
      },
    });

    if (respuesta.estado !== 201) {
      throw new Error(
        `No se pudo crear la persona ${marca}: ${respuesta.estado} ${JSON.stringify(respuesta.cuerpo)}`,
      );
    }

    // Se registra para que la limpieza sepa que fila es de esta suite: el documento ya
    // no sirve como marca porque esta cifrado.
    registrarPersona(respuesta.cuerpo.id);

    return respuesta.cuerpo.id;
  }

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    rrhh = await tokenRRHH(app);

    // Catalogo de la empresa A, que es la del rol RRHH.
    personaId = await crearPersona('EMP');

    const departamento = await llamar(app, 'POST', '/departamentos', {
      token: rrhh,
      cuerpo: {
        codigo: `DEPE-${SUFIJO}`,
        nombre: `Departamento de empleados ${SUFIJO}`,
      },
    });
    departamentoId = departamento.cuerpo.id;

    const puesto = await llamar(app, 'POST', '/puestos', {
      token: rrhh,
      cuerpo: {
        codigo: `PUEE-${SUFIJO}`,
        nombre: `Puesto de prueba ${SUFIJO}`,
      },
    });
    puestoId = puesto.cuerpo.id;
  });

  afterAll(async () => {
    // El orden lo impone la FK: primero los empleados, luego personas, y los
    // catalogos al final. Si se invirtiera, el DELETE fallaria por restriccion.
    //
    // Se borra por los ids que la suite registro al crear, no buscando por el documento:
    // el documento esta cifrado y un `LIKE` sobre el texto cifrado no encuentra nada.
    // Los empleados se buscan por su persona o por su propio id, porque algunos se
    // crean directamente por SQL en las pruebas de aislamiento entre empresas.
    const personas = await consultar(
      conexion,
      'SELECT id FROM persona WHERE id IN (?)',
      [idsDePersonasCreadas()],
    );
    const empleados = await consultar(
      conexion,
      'SELECT id FROM empleado WHERE persona_id IN (?) OR id IN (?)',
      [idsDePersonasCreadas(), idsDeEmpleadosCreados()],
    );
    const departamentos = await consultar(
      conexion,
      'SELECT id FROM departamento WHERE codigo LIKE ?',
      [`%-${SUFIJO}`],
    );
    const puestos = await consultar(
      conexion,
      'SELECT id FROM puesto WHERE codigo LIKE ?',
      [`%-${SUFIJO}`],
    );

    await borrarEn(
      conexion,
      "DELETE FROM auditoria WHERE entidad = 'empleado' AND entidad_id IN (?)",
      empleados.map((e) => e.id as string),
    );
    await borrarEn(
      conexion,
      'DELETE FROM empleado WHERE id IN (?)',
      empleados.map((e) => e.id as string),
    );

    await borrarEn(
      conexion,
      "DELETE FROM auditoria WHERE entidad = 'persona' AND entidad_id IN (?)",
      personas.map((p) => p.id as string),
    );
    await borrarEn(
      conexion,
      'DELETE FROM persona WHERE id IN (?)',
      personas.map((p) => p.id as string),
    );

    await borrarEn(
      conexion,
      "DELETE FROM auditoria WHERE entidad = 'departamento' AND entidad_id IN (?)",
      departamentos.map((d) => d.id as string),
    );
    await borrarEn(
      conexion,
      'DELETE FROM departamento WHERE id IN (?)',
      departamentos.map((d) => d.id as string),
    );

    await borrarEn(
      conexion,
      "DELETE FROM auditoria WHERE entidad = 'puesto' AND entidad_id IN (?)",
      puestos.map((p) => p.id as string),
    );
    await borrarEn(
      conexion,
      'DELETE FROM puesto WHERE id IN (?)',
      puestos.map((p) => p.id as string),
    );

    await conexion.end();
    await app.close();
  });

  describe('1. Alta con referencias coherentes', () => {
    it('un alta invalida responde 400 con los campos que fallan', async () => {
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: 'no-es-un-uuid',
          tipo_contrato: 'INDEFINIDO',
          fecha_ingreso: 'ayer',
        },
      });

      const campos = [
        ...new Set((respuesta.cuerpo?.errores ?? []).map((e: any) => e.campo)),
      ];

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo?.errores)).toBe(
        400,
      );
      expect(campos).toContain('persona_id');
      expect(campos).toContain('tipo_contrato');
      expect(campos).toContain('fecha_ingreso');
    });

    it('un alta valida responde 201 y guarda la empresa de la sesion', async () => {
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: personaId,
          departamento_id: departamentoId,
          puesto_id: puestoId,
          fecha_ingreso: '2026-01-15',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
      expect(respuesta.cuerpo?.empresa_id).toBe(empresaA);
      expect(respuesta.cuerpo?.persona_id).toBe(personaId);
      expect(respuesta.cuerpo?.departamento_id).toBe(departamentoId);
      expect(respuesta.cuerpo?.puesto_id).toBe(puestoId);
      expect(respuesta.cuerpo?.tipo_contrato).toBe('PLANTA');
      expect(respuesta.cuerpo?.fecha_fin).toBeNull();
      expect(respuesta.cuerpo?.activo).toBe(true);

      empleadoId = respuesta.cuerpo.id;
      registrarEmpleado(empleadoId);
    });

    it('no acepta empresa_id en el cuerpo: la empresa sale del token', async () => {
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: personaId,
          fecha_ingreso: '2026-01-15',
          empresa_id: empresaB,
        },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some((e: any) => e.campo === 'empresa_id'),
      ).toBe(true);
    });

    it('la misma persona no puede estar dos veces de alta en la misma empresa', async () => {
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: { persona_id: personaId, fecha_ingreso: '2026-02-01' },
      });

      expect(respuesta.estado).toBe(409);
      expect(respuesta.cuerpo?.message).toContain('ya esta dada de alta');
    });
  });

  describe('2. Las referencias tienen que ser de esta empresa', () => {
    it('un departamento de otra empresa se rechaza con un 400 claro', async () => {
      // El departamento se inserta por SQL porque el rol de la empresa B no puede crear
      // catalogos, y aqui lo que se prueba es la FK, no el permiso.
      const id = crypto.randomUUID();
      await conexion.query(
        'INSERT INTO departamento (id, empresa_id, codigo, nombre, activo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(3), NOW(3))',
        [id, empresaB, `DEPB-${SUFIJO}`, `Departamento ajeno ${SUFIJO}`],
      );

      const persona = await crearPersona('XDEP');

      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: persona,
          departamento_id: id,
          fecha_ingreso: '2026-02-01',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(400);
      expect(respuesta.cuerpo?.message).toContain('no existe en esta empresa');
    });

    it('un puesto de otra empresa se rechaza con un 400 claro', async () => {
      const id = crypto.randomUUID();
      await conexion.query(
        'INSERT INTO puesto (id, empresa_id, codigo, nombre, activo, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NOW(3), NOW(3))',
        [id, empresaB, `PUEB-${SUFIJO}`, `Puesto ajeno ${SUFIJO}`],
      );

      const persona = await crearPersona('XPUE');

      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: persona,
          puesto_id: id,
          fecha_ingreso: '2026-02-01',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(400);
      expect(respuesta.cuerpo?.message).toContain('no existe en esta empresa');
    });

    it('una persona inexistente responde 404', async () => {
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: '00000000-0000-4000-8000-000000000000',
          fecha_ingreso: '2026-02-01',
        },
      });

      expect(respuesta.estado).toBe(404);
    });

    it('una persona dada de baja no puede tener empleados', async () => {
      const persona = await crearPersona('INACT');
      await llamar(app, 'PATCH', `/personas/${persona}`, {
        token: rrhh,
        cuerpo: { activo: false },
      });

      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: { persona_id: persona, fecha_ingreso: '2026-02-01' },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(400);
      expect(respuesta.cuerpo?.message).toContain('esta dada de baja');
    });
  });

  describe('3. Periodo del contrato', () => {
    it('una fecha de fin anterior al ingreso se rechaza', async () => {
      const persona = await crearPersona('FECHAS');

      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: persona,
          fecha_ingreso: '2026-05-01',
          fecha_fin: '2026-04-30',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(400);
      expect(respuesta.cuerpo?.message).toContain(
        'no puede ser anterior a la fecha de ingreso',
      );
    });

    it('el mismo ingreso y la misma fecha de fin si se admiten', async () => {
      const persona = await crearPersona('MISMA');

      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: persona,
          fecha_ingreso: '2026-05-01',
          fecha_fin: '2026-05-01',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
    });
  });

  describe('4. Aislamiento entre empresas', () => {
    it('con permiso de lectura pero de otra empresa, responde 404 y no 403', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.leer'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'GET',
            `/empleados/${empleadoId}`,
            {
              token,
            },
          );

          expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(404);
        },
      );
    });

    it('el listado de la otra empresa no ve los empleados de esta', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.leer'],
        async (token) => {
          const respuesta = await llamar(app, 'GET', '/empleados', { token });

          expect(respuesta.estado).toBe(200);
          expect(respuesta.cuerpo.total).toBe(0);
        },
      );
    });

    it('crear sigue exigiendo permiso de escritura: 403 aunque lea', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.leer'],
        async (token) => {
          const respuesta = await llamar(app, 'POST', '/empleados', {
            token,
            cuerpo: { persona_id: personaId, fecha_ingreso: '2026-06-01' },
          });

          expect(respuesta.estado).toBe(403);
        },
      );
    });

    it('modificar un empleado de otra empresa responde 403', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.leer'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'PATCH',
            `/empleados/${empleadoId}`,
            {
              token,
              cuerpo: { tipo_contrato: 'PRACTICAS' },
            },
          );

          expect(respuesta.estado).toBe(403);
        },
      );
    });

    it('ninguna de esas operaciones ajenas ha tocado la fila', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT tipo_contrato, deleted_at FROM empleado WHERE id = ?',
        [empleadoId],
      );

      expect(fila?.tipo_contrato).toBe('PLANTA');
      expect(fila?.deleted_at).toBeNull();
    });
  });

  describe('5. Listado y busqueda', () => {
    it('el listado responde con el empleado creado', async () => {
      const respuesta = await llamar(app, 'GET', '/empleados', { token: rrhh });

      expect(respuesta.estado).toBe(200);
      expect(Object.keys(respuesta.cuerpo).sort().join(',')).toBe(
        'datos,pagina,por_pagina,total',
      );
      expect(
        respuesta.cuerpo?.datos?.some((e: any) => e.id === empleadoId),
      ).toBe(true);
    });

    it('el filtro por persona devuelve solo a esa persona', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/empleados?persona_id=${personaId}`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.total).toBe(1);
      expect(respuesta.cuerpo?.datos?.[0]?.id).toBe(empleadoId);
    });

    it('la busqueda por texto llega a los nombres de la persona', async () => {
      // El listado se filtra por empleado, pero quien busca "Apellido" quiere encontrar a
      // la persona: el nombre no vive en la tabla de empleado.
      const respuesta = await llamar(
        app,
        'GET',
        `/empleados?buscar=${encodeURIComponent(`Apellido ${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(200);
      expect(
        respuesta.cuerpo?.datos?.some((e: any) => e.id === empleadoId),
      ).toBe(true);
    });

    it('el filtro vigente_en solo trae contratos en vigor en esa fecha', async () => {
      const dentro = await llamar(
        app,
        'GET',
        '/empleados?vigente_en=2026-01-20',
        {
          token: rrhh,
        },
      );
      const antes = await llamar(
        app,
        'GET',
        '/empleados?vigente_en=2026-01-01',
        {
          token: rrhh,
        },
      );

      expect(dentro.cuerpo?.datos?.some((e: any) => e.id === empleadoId)).toBe(
        true,
      );
      // El empleado ingreso el 15 de enero: el dia 1 todavia no estaba.
      expect(antes.cuerpo?.datos?.some((e: any) => e.id === empleadoId)).toBe(
        false,
      );
    });

    it('una fecha de filtro invalida responde 400', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/empleados?vigente_en=2026-13-01',
        {
          token: rrhh,
        },
      );

      expect(respuesta.estado).toBe(400);
    });
  });

  describe('6. Modificacion', () => {
    it('PATCH cambia solo el campo enviado y responde el empleado completo', async () => {
      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { puesto_id: null },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(200);
      // Un `null` explicito si significa "dejarlo vacio": un empleado puede quedarse
      // sin puesto.
      expect(respuesta.cuerpo.puesto_id).toBeNull();
      expect(respuesta.cuerpo.departamento_id).toBe(departamentoId);
      expect(respuesta.cuerpo.persona_id).toBe(personaId);
      expect(respuesta.cuerpo.tipo_contrato).toBe('PLANTA');
    });

    it('no se puede cambiar la persona del empleado', async () => {
      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { persona_id: personaId },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some(
          (e: any) => e.mensaje === 'no es un campo permitido',
        ),
      ).toBe(true);
    });

    it('mover la fecha de fin antes del ingreso se rechaza', async () => {
      // El periodo se comprueba sobre lo que quedara, no solo sobre lo enviado: si solo
      // se mirara el PATCH, mover la fecha de fin a antes del ingreso pasaria.
      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { fecha_fin: '2025-01-01' },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(400);
      expect(respuesta.cuerpo?.message).toContain(
        'no puede ser anterior a la fecha de ingreso',
      );
    });

    it('asignar un departamento de otra empresa se rechaza', async () => {
      const [ajeno] = await consultar(
        conexion,
        'SELECT id FROM puesto WHERE empresa_id = ? LIMIT 1',
        [empresaB],
      );

      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { puesto_id: ajeno?.id },
      });

      expect(respuesta.estado).toBe(400);
      expect(respuesta.cuerpo?.message).toContain('no existe en esta empresa');
    });
  });

  describe('7. Baja logica y efecto sobre la persona', () => {
    it('DELETE responde 204 y conserva la fila', async () => {
      const respuesta = await llamar(
        app,
        'DELETE',
        `/empleados/${empleadoId}`,
        {
          token: rrhh,
        },
      );

      expect(respuesta.estado).toBe(204);

      const [fila] = await consultar(
        conexion,
        'SELECT deleted_at, activo FROM empleado WHERE id = ?',
        [empleadoId],
      );

      expect(fila?.deleted_at).not.toBeNull();
      expect(fila?.activo).toBe(0);
    });

    it('la misma persona puede volver a darse de alta tras la baja', async () => {
      // `empresa_persona_vigente` pasa a NULL en las filas borradas: la vincula queda
      // libre para un reingreso.
      const respuesta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: { persona_id: personaId, fecha_ingreso: '2026-07-01' },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
    });

    it('una persona con empleados no se puede dar de baja', async () => {
      personaConEmpleadoId = await crearPersona('VIVA');
      const alta = await llamar(app, 'POST', '/empleados', {
        token: rrhh,
        cuerpo: {
          persona_id: personaConEmpleadoId,
          fecha_ingreso: '2026-07-01',
        },
      });
      expect(alta.estado).toBe(201);
      registrarEmpleado(alta.cuerpo.id);

      const respuesta = await llamar(
        app,
        'DELETE',
        `/personas/${personaConEmpleadoId}`,
        {
          token: rrhh,
        },
      );

      // Sin esta comprobacion, MySQL rechazaria el borrado con un error de FK en
      // ingles, y el cliente no sabria que lo que falla es que tiene empleados.
      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(409);
      expect(respuesta.cuerpo?.message).toContain('empleado asociado');
    });
  });
});
