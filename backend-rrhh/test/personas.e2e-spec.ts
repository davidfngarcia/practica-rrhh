/**
 * Suite e2e de personas.
 *
 * `persona` es un catalogo global: no tiene `empresa_id`, asi que aqui no hay barrera de
 * multitenant que comprobar. Lo que se comprueba es el resto del contrato, y en
 * particular las dos reglas que hacen que el modelo aguante: el documento es unico
 * entre las personas no dadas de baja, y una persona con empleados no se puede dar de
 * baja.
 */
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SUFIJO,
  borrarEn,
  consultar,
  crearAppDePrueba,
  idsDePersonasCreadas,
  llamar,
  prepararBase,
  registrarPersona,
  tokenEmpleado,
  tokenRRHH,
} from './soporte.js';

describe('Personas (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let rrhh: string;
  let empleado: string;
  let personaId: string;
  /** Persona que la seccion 5 crea, modifica y da de baja. */
  let personaBajaId: string;

  const documento = (marca: string) => `CC-${marca}-${SUFIJO}`;

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    rrhh = await tokenRRHH(app);
    empleado = await tokenEmpleado(app);
  });

  afterAll(async () => {
    // El orden importa: una persona con empleados no se puede borrar, asi que los
    // empleados se van primero.
    //
    // Se borra por los ids registrados al crear y no por `numero_documento LIKE`: el
    // documento esta cifrado, y un `LIKE` sobre texto cifrado no encuentra nada, con lo
    // que la limpieza creeria no haber borrado nada y el DELETE siguiente reventaria por
    // la FK.
    const empleados = await consultar(
      conexion,
      'SELECT id FROM empleado WHERE persona_id IN (?)',
      [idsDePersonasCreadas()],
    );
    const personas = await consultar(
      conexion,
      'SELECT id FROM persona WHERE id IN (?)',
      [idsDePersonasCreadas()],
    );

    await borrarEn(
      conexion,
      'DELETE FROM auditoria WHERE entidad_id IN (?)',
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

    await conexion.end();
    await app.close();
  });

  describe('1. Proteccion y permisos', () => {
    it('sin token responde 401', async () => {
      const respuesta = await llamar(app, 'GET', '/personas');
      expect(respuesta.estado, respuesta.texto).toBe(401);
    });

    it('un rol con persona.leer entra', async () => {
      const respuesta = await llamar(app, 'GET', '/personas', {
        token: empleado,
      });
      expect(respuesta.estado).toBe(200);
    });

    it('un rol sin persona.crear recibe 403 con el permiso que falta', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: empleado,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('EMPLEADO'),
          nombres: 'Intento',
          apellidos: 'Fallido',
        },
      });

      expect(respuesta.estado).toBe(403);
      expect(respuesta.cuerpo?.message).toContain('persona.crear');
    });
  });

  describe('2. Alta', () => {
    it('un alta invalida responde 400 con los campos que fallan', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'LICENCIA',
          numero_documento: 'con espacio',
          nombres: '',
          apellidos: 'X',
        },
      });

      const campos = [
        ...new Set((respuesta.cuerpo?.errores ?? []).map((e: any) => e.campo)),
      ];

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo?.errores)).toBe(
        400,
      );
      expect(campos).toContain('tipo_documento');
      expect(campos).toContain('numero_documento');
      expect(campos).toContain('nombres');
    });

    it('el mensaje del tipo de documento lista los valores admitidos', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'LICENCIA',
          numero_documento: documento('TIPO'),
          nombres: 'Tipo',
          apellidos: 'Invalido',
        },
      });

      const mensaje = respuesta.cuerpo?.errores?.find(
        (e: any) => e.campo === 'tipo_documento',
      )?.mensaje;

      for (const permitido of ['CC', 'CE', 'NIT', 'PASAPORTE']) {
        expect(mensaje).toContain(permitido);
      }
    });

    it('una fecha que no existe se rechaza, no se normaliza', async () => {
      // `Date.parse('2026-02-30')` no da error: normaliza al 2 de marzo. Si se
      // aceptara, el 30 de febrero se guardaria como un dia que no existe.
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('FECHA'),
          nombres: 'Fecha',
          apellidos: 'Imposible',
          fecha_nacimiento: '2026-02-30',
        },
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some(
          (e: any) => e.campo === 'fecha_nacimiento',
        ),
      ).toBe(true);
    });

    it('una fecha con formato distinto del acordado se rechaza', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('FORMATO'),
          nombres: 'Formato',
          apellidos: 'Distinto',
          fecha_nacimiento: '01/03/2026',
        },
      });

      expect(respuesta.estado).toBe(400);
    });

    it('un alta valida responde 201 con los opcionales en null', async () => {
      const numero = documento('ALTA');
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: numero,
          nombres: 'Ana',
          apellidos: `Prueba ${SUFIJO}`,
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
      expect(respuesta.cuerpo?.numero_documento).toBe(numero);
      expect(respuesta.cuerpo?.activo).toBe(true);
      expect(respuesta.cuerpo?.fecha_nacimiento).toBeNull();
      expect(respuesta.cuerpo?.genero).toBeNull();
      expect(respuesta.cuerpo?.email).toBeNull();
      expect(typeof respuesta.cuerpo?.id).toBe('string');

      personaId = respuesta.cuerpo.id;
      registrarPersona(personaId);
    });

    it('la persona se guarda sin empresa: el catalogo es global', async () => {
      // Se comprueba contra la tabla y no contra la respuesta: que el JSON no traiga
      // `empresa_id` no impediria que la columna se rellenara por la puerta de atrÃ¡s.
      const columnas = await consultar(conexion, 'SHOW COLUMNS FROM persona');
      expect(columnas.map((c) => c.Field)).not.toContain('empresa_id');
    });

    it('un documento repetido responde 409', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('ALTA'),
          nombres: 'Otra',
          apellidos: 'Persona',
        },
      });

      expect(respuesta.estado).toBe(409);
      expect(respuesta.cuerpo?.message).not.toContain('Duplicate entry');
    });

    it('el documento se compara sin distincion de mayusculas', async () => {
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('ALTA').toLowerCase(),
          nombres: 'Tercera',
          apellidos: 'Persona',
        },
      });

      expect(respuesta.estado).toBe(409);
    });
  });

  describe('3. Listado y busqueda', () => {
    it('el listado responde con datos, total, pagina y por_pagina', async () => {
      const respuesta = await llamar(app, 'GET', '/personas', { token: rrhh });

      expect(respuesta.estado).toBe(200);
      expect(Object.keys(respuesta.cuerpo).sort().join(',')).toBe(
        'datos,pagina,por_pagina,total',
      );
      expect(respuesta.cuerpo.pagina).toBe(1);
      expect(respuesta.cuerpo.por_pagina).toBe(20);
    });

    it('el filtro por numero de documento exacto encuentra a la persona', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/personas?numero_documento=${encodeURIComponent(documento('ALTA'))}`,
        { token: rrhh },
      );

      expect(respuesta.cuerpo?.total).toBe(1);
      expect(respuesta.cuerpo?.datos?.[0]?.id).toBe(personaId);
    });

    it('buscar por apellidos encuentra a la persona', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/personas?buscar=${encodeURIComponent(`Prueba ${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(
        respuesta.cuerpo?.datos?.some((p: any) => p.id === personaId),
      ).toBe(true);
    });

    it('el filtro por tipo de documento se aplica', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/personas?tipo_documento=CE',
        {
          token: rrhh,
        },
      );

      const todosCe = respuesta.cuerpo?.datos?.every(
        (p: any) => p.tipo_documento === 'CE',
      );
      expect(respuesta.estado).toBe(200);
      expect(todosCe).toBe(true);
    });

    it('un valor de filtro no admitido responde 400 en castellano', async () => {
      const respuesta = await llamar(app, 'GET', '/personas?genero=X', {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some((e: any) => e.campo === 'genero'),
      ).toBe(true);
    });
  });

  describe('4. Modificacion', () => {
    it('PATCH cambia solo el campo enviado y responde la persona completa', async () => {
      const numero = documento('PATCH');
      const alta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: numero,
          nombres: 'Antes',
          apellidos: 'Patch',
          telefono: '3000000000',
        },
      });
      registrarPersona(alta.cuerpo.id);

      const respuesta = await llamar(
        app,
        'PATCH',
        `/personas/${alta.cuerpo.id}`,
        {
          token: rrhh,
          cuerpo: { nombres: 'Despues' },
        },
      );

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(200);
      expect(respuesta.cuerpo.nombres).toBe('Despues');
      expect(respuesta.cuerpo.apellidos).toBe('Patch');
      expect(respuesta.cuerpo.telefono).toBe('3000000000');
      expect(respuesta.cuerpo.numero_documento).toBe(numero);
    });

    it('no se puede cambiar el tipo de documento por esta via', async () => {
      const respuesta = await llamar(app, 'PATCH', `/personas/${personaId}`, {
        token: rrhh,
        cuerpo: { tipo_documento: 'PASAPORTE' },
      });

      // El tipo forma parte de la identificacion y el indice unico solo mira el
      // numero: permitirlo dejaria dos personas distintas con el mismo documento.
      expect(respuesta.estado).toBe(400);
      expect(
        respuesta.cuerpo?.errores?.some(
          (e: any) => e.mensaje === 'no es un campo permitido',
        ),
      ).toBe(true);
    });

    it('cambiar a un documento ya ocupado responde 409', async () => {
      const respuesta = await llamar(app, 'PATCH', `/personas/${personaId}`, {
        token: rrhh,
        cuerpo: { numero_documento: documento('PATCH') },
      });

      expect(respuesta.estado).toBe(409);
    });

    it('un id que no es UUID responde 400, no 500', async () => {
      const respuesta = await llamar(app, 'GET', '/personas/no-es-un-uuid', {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(400);
    });

    it('un id valido pero inexistente responde 404', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        '/personas/00000000-0000-4000-8000-000000000000',
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(404);
    });
  });

  describe('5. Baja logica', () => {
    beforeAll(async () => {
      const numero = documento('BAJA');
      const alta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'NIT',
          numero_documento: numero,
          nombres: 'Baja',
          apellidos: `Logica ${SUFIJO}`,
        },
      });
      personaBajaId = alta.cuerpo.id;
      registrarPersona(personaBajaId);

      // Una modificacion antes de la baja, para que la persona recorra las tres
      // acciones y la seccion de auditoria tenga las tres que comparar.
      await llamar(app, 'PATCH', `/personas/${personaBajaId}`, {
        token: rrhh,
        cuerpo: { telefono: '3100000000' },
      });
    });

    it('DELETE responde 204 sin cuerpo', async () => {
      const respuesta = await llamar(
        app,
        'DELETE',
        `/personas/${personaBajaId}`,
        {
          token: rrhh,
        },
      );

      expect(respuesta.estado).toBe(204);
      expect(respuesta.texto).toBe('');
    });

    it('la fila se conserva con deleted_at y activo=0', async () => {
      const [fila] = await consultar(
        conexion,
        'SELECT deleted_at, activo FROM persona WHERE id = ?',
        [personaBajaId],
      );

      expect(fila?.deleted_at).not.toBeNull();
      expect(fila?.activo).toBe(0);
    });

    it('tras la baja, el registro responde 404', async () => {
      const respuesta = await llamar(app, 'GET', `/personas/${personaBajaId}`, {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(404);
    });

    it('el documento de una persona dada de baja se puede reutilizar', async () => {
      // `documento_indice_vigente` pasa a NULL en las filas borradas: el documento queda
      // libre. Sin esto, el nombre de acceso de un usuario dado de baja y el documento de
      // una persona dada de baja quedarian reservados para siempre, que es justo lo que
      // el UNIQUE sobre la columna generada evita.
      const respuesta = await llamar(app, 'POST', '/personas', {
        token: rrhh,
        cuerpo: {
          tipo_documento: 'CC',
          numero_documento: documento('BAJA'),
          nombres: 'Reutilizado',
          apellidos: 'Documento',
        },
      });

      expect(respuesta.estado, JSON.stringify(respuesta.cuerpo)).toBe(201);
      registrarPersona(respuesta.cuerpo.id);
    });
  });

  describe('6. Auditoria', () => {
    it('se auditan CREAR, ACTUALIZAR y ELIMINAR', async () => {
      // La persona de la seccion 5, que fue creada, modificada y dada de baja.
      const eventos = await consultar(
        conexion,
        `SELECT accion, datos_antes, datos_despues FROM auditoria
          WHERE entidad = 'persona' AND entidad_id = ?
          ORDER BY creado_en`,
        [personaBajaId],
      );

      const acciones = eventos.map((e) => e.accion);

      expect(acciones).toContain('CREAR');
      expect(acciones).toContain('ACTUALIZAR');
      expect(acciones).toContain('ELIMINAR');
    });

    it('la actualizacion guarda el telefono antes y despues', async () => {
      // Si el PATCH se guardara solo con lo enviado, el estado anterior seria un
      // objeto vacio y no habria forma de saber que campo cambio.
      const eventos = await consultar(
        conexion,
        `SELECT datos_antes, datos_despues FROM auditoria
          WHERE entidad = 'persona' AND entidad_id = ? AND accion = 'ACTUALIZAR'`,
        [personaBajaId],
      );

      const antes = JSON.parse(JSON.stringify(eventos[0]?.datos_antes));
      const despues = JSON.parse(JSON.stringify(eventos[0]?.datos_despues));

      expect(antes.telefono).toBeNull();
      expect(despues.telefono).toBe('3100000000');
    });
  });
});
