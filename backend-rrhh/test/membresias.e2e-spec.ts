/**
 * Membresías (e2e).
 *
 * Aquí lo que hay que demostrar es integridad, no CRUD. Conceder un rol de otra empresa
 * es el fallo grave, porque no da error: concede permisos de verdad, dentro del tenant
 * equivocado. Y las reglas que impiden dejar la empresa inservible —quitarse el rol
 * propio y quedarse sin ningún administrador— tampoco se ven leyendo el código: se ven
 * cuando alguien lo intenta.
 */
import * as bcrypt from 'bcrypt';
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS_PRUEBA,
  SUFIJO,
  tokenEmpleado,
  llamar,
  prepararBase,
  consultar,
  crearAppDePrueba,
  iniciarSesion,
  tokenAdmin,
} from './soporte.js';
import {
  PASSWORD_PRUEBA,
  USUARIO_ADMIN_PRUEBA,
} from '../src/database/semilla.js';

const { empresaA, empresaB, usuarioAdmin } = IDS_PRUEBA;

describe('Membresías (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let admin: string;
  let adminB: string;

  /** Permisos concedidos temporalmente, como `rol_id:codigo`. */
  const permisosConcedidos: { rolId: string; codigo: string }[] = [];

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    admin = await tokenAdmin(app);
    adminB = await iniciarSesion(app, empresaB, USUARIO_ADMIN_PRUEBA);
  });

  afterAll(async () => {
    // El orden importa por las FK: primero la auditoria, que apunta a las membresias;
    // luego las membresias, que apuntan a usuarios y roles; y al final los usuarios y los
    // roles, que ya no tienen a nadie colgando.
    for (const { rolId, codigo } of permisosConcedidos) {
      await conexion.query(
        `DELETE rp FROM rol_permiso rp
           JOIN permiso p ON p.id = rp.permiso_id
          WHERE rp.rol_id = ? AND p.codigo = ?`,
        [rolId, codigo],
      );
    }

    // La limpieza va por SUFIJO y no por los ids recogidos. Es la diferencia entre una
    // suite que deja la base como la encontro y una que la deja sucia para siempre: si una
    // prueba falla a mitad, o una peticion devuelve algo que no se espera y la fila ni
    // llega a anotarse, el borrado por id no la encuentra, y al siguiente run queda un
    // administrador fantasma que hace fallar la regla del ultimo administrador sin que
    // nadie haya tocado ese codigo.
    const sufijo = `%-${SUFIJO}`;

    const usuarios = await consultar(
      conexion,
      'SELECT id FROM usuarios WHERE usuario LIKE ?',
      [sufijo],
    );
    const usuarioIds = usuarios.map((u) => u.id as string);

    if (usuarioIds.length > 0) {
      const membresias = await consultar(
        conexion,
        'SELECT id FROM usuario_empresa WHERE usuario_id IN (?)',
        [usuarioIds],
      );
      const membresiaIds = membresias.map((m) => m.id as string);

      if (membresiaIds.length > 0) {
        await conexion.query(
          "DELETE FROM auditoria WHERE entidad = 'usuario_empresa' AND entidad_id IN (?)",
          [membresiaIds],
        );
        await conexion.query('DELETE FROM usuario_empresa WHERE id IN (?)', [
          membresiaIds,
        ]);
      }

      await conexion.query('DELETE FROM usuarios WHERE id IN (?)', [
        usuarioIds,
      ]);
    }

    const roles = await consultar(
      conexion,
      'SELECT id FROM rol WHERE codigo LIKE ?',
      [sufijo],
    );
    for (const { id } of roles) {
      await conexion.query('DELETE FROM rol_permiso WHERE rol_id = ?', [id]);
      await conexion.query(
        "DELETE FROM auditoria WHERE entidad = 'rol' AND entidad_id = ?",
        [id],
      );
      await conexion.query('DELETE FROM rol WHERE id = ?', [id]);
    }

    await app.close();
    await conexion.end();
  });

  /** Id del rol con ese código DENTRO de una empresa. */
  async function idDeRol(
    codigo: string,
    empresaId: string = empresaA,
  ): Promise<string> {
    const filas = await consultar(
      conexion,
      'SELECT id FROM rol WHERE codigo = ? AND empresa_id = ?',
      [codigo, empresaId],
    );
    if (filas.length === 0) throw new Error(`No existe el rol ${codigo}`);
    return filas[0].id as string;
  }

  /** Id de la membresía de un usuario en una empresa. */
  async function idDeMembresia(
    nombreUsuario: string,
    empresaId = empresaA,
  ): Promise<string> {
    const filas = await consultar(
      conexion,
      `SELECT ue.id FROM usuario_empresa ue
         JOIN usuarios u ON u.id = ue.usuario_id
        WHERE ue.empresa_id = ? AND ue.deleted_at IS NULL AND u.usuario = ?`,
      [empresaId, nombreUsuario],
    );
    if (filas.length === 0) throw new Error(`${nombreUsuario} no es miembro`);
    return filas[0].id as string;
  }

  /**
   * Crea un usuario de descarte, con su hash y todo.
   *
   * Va por SQL porque la API de usuarios globales todavía no existe, y esperarla
   * convertiría esta suite en una prueba de otra cosa. Lo que importa es que la persona
   * existe de verdad y con `activo = 1`, y que su contraseña es la de la semilla: así
   * `iniciarSesion` la puede usar igual que a cualquier otro usuario.
   */
  async function crearUsuario(nombre: string): Promise<string> {
    const id = crypto.randomUUID();
    const hash = await bcrypt.hash(PASSWORD_PRUEBA, 10);
    await conexion.query(
      `INSERT INTO usuarios (id, usuario, password_hash, email, activo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NOW(3), NOW(3))`,
      [id, nombre, hash, `${nombre}@ejemplo.local`],
    );
    return id;
  }

  /** Da de alta un usuario de descarte y devuelve la respuesta de la API. */
  async function crearMembresia(nombre: string, codigoRol: string) {
    const usuarioId = await crearUsuario(nombre);
    const respuesta = await llamar(app, 'POST', '/membresias', {
      token: admin,
      cuerpo: { usuario_id: usuarioId, rol_id: await idDeRol(codigoRol) },
    });
    return respuesta;
  }

  /**
   * Concede un permiso a un rol hasta terminar la prueba, y lo revoca al salir.
   *
   * Se mira solo lo que esta ejecución concedió, y no "el rol tiene exactamente los
   * permisos de la semilla": las suites comparten base y corren en paralelo, así que una
   * comprobación global puede ver lo que otra está concediendo en ese mismo instante y
   * fallar sin que nadie haya roto nada.
   */
  async function conPermisos(
    rolId: string,
    codigos: string[],
    prueba: (token: string) => Promise<void>,
  ): Promise<void> {
    const concedidos: string[] = [];

    for (const codigo of codigos) {
      const [permiso] = await consultar(
        conexion,
        'SELECT id FROM permiso WHERE codigo = ?',
        [codigo],
      );
      if (!permiso) throw new Error(`No existe el permiso ${codigo}`);

      const [resultado] = await conexion.query(
        'INSERT IGNORE INTO rol_permiso (rol_id, permiso_id) VALUES (?, ?)',
        [rolId, permiso.id],
      );
      const cabecera = resultado as { affectedRows?: number };
      // `affectedRows === 0` significa que el permiso YA estaba, y en ese caso no hay que
      // revocarlo al terminar: no es de esta ejecución y revocar rompería a otra suite.
      if ((cabecera.affectedRows ?? 0) > 0) {
        concedidos.push(codigo);
        permisosConcedidos.push({ rolId, codigo });
      }
    }

    // Token nuevo: los permisos se releen de la base en cada petición, así que el token
    // emitido antes de concederlos sirve para antes, no para después.
    await prueba(await iniciarSesion(app, empresaA, USUARIO_ADMIN_PRUEBA));
  }

  describe('1. Aislamiento entre empresas', () => {
    it('el listado solo trae miembros de la empresa de la sesión', async () => {
      const nombre = `MEMBER-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);

      const enA = await llamar(app, 'GET', '/membresias?por_pagina=100', {
        token: admin,
      });
      expect(enA.estado).toBe(200);
      expect(
        (enA.cuerpo as { datos: { usuario: { usuario: string } }[] }).datos.map(
          (m) => m.usuario.usuario,
        ),
      ).toContain(nombre);

      const enB = await llamar(app, 'GET', '/membresias?por_pagina=100', {
        token: adminB,
      });
      expect(
        (enB.cuerpo as { datos: { usuario: { usuario: string } }[] }).datos.map(
          (m) => m.usuario.usuario,
        ),
      ).not.toContain(nombre);
    });

    it('una membresía de otra empresa es 404 al pedirla, editarla o borrarla', async () => {
      const nombre = `AJENA-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);
      const id = (await idDeMembresia(nombre)) as string;

      expect(
        (await llamar(app, 'GET', `/membresias/${id}`, { token: adminB }))
          .estado,
      ).toBe(404);
      expect(
        (
          await llamar(app, 'PATCH', `/membresias/${id}`, {
            token: adminB,
            cuerpo: { activo: false },
          })
        ).estado,
      ).toBe(404);
      expect(
        (await llamar(app, 'DELETE', `/membresias/${id}`, { token: adminB }))
          .estado,
      ).toBe(404);
    });

    it('no se puede asignar el rol de otra empresa', async () => {
      // Este es el fallo que de verdad importa. La FK solo comprueba que el rol existe,
      // así que sin este filtro a alguien de la empresa A se le podrían conceder los
      // permisos de la empresa B. Y no fallaría: concedería.
      const usuarioId = await crearUsuario(`ROLAJENO-${SUFIJO}`);

      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: {
          usuario_id: usuarioId,
          rol_id: await idDeRol('RRHH', empresaB),
        },
      });

      // 404 y no 400: para quien pregunta, ese rol no existe en su empresa.
      expect(respuesta.estado).toBe(404);
    });

    it('no se puede asignar un rol de plantilla', async () => {
      // Las plantillas tienen `empresa_id IS NULL`. Asignar una daría a alguien un rol que
      // no existe dentro de su empresa, y tocar sus permisos desde el panel de la empresa
      // cambiaría las tres copias de golpe.
      const [plantilla] = await consultar(
        conexion,
        'SELECT id FROM rol WHERE es_sistema = 1 AND empresa_id IS NULL AND codigo = ?',
        ['EMPLEADO'],
      );

      const usuarioId = await crearUsuario(`PLANTILLA-${SUFIJO}`);
      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: { usuario_id: usuarioId, rol_id: plantilla.id },
      });

      expect(respuesta.estado).toBe(404);
    });

    it('un usuario que no existe es 404', async () => {
      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: {
          usuario_id: '00000000-0000-4000-8000-000000000000',
          rol_id: await idDeRol('RRHH'),
        },
      });

      expect(respuesta.estado).toBe(404);
    });

    it('un usuario desactivado no se puede dar de alta', async () => {
      const nombre = `INACTIVO-${SUFIJO}`;
      const usuarioId = await crearUsuario(nombre);
      await conexion.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [
        usuarioId,
      ]);

      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: { usuario_id: usuarioId, rol_id: await idDeRol('EMPLEADO') },
      });

      expect(respuesta.estado).toBe(400);
    });

    it('un rol desactivado no se puede asignar', async () => {
      // Rol de descarte y no el RRHH de la empresa: desactivar el rol compartido por SQL
      // rompería las suites que están corriendo en paralelo.
      const nombre = `ROLAPAGADO-${SUFIJO}`;
      const rolId = crypto.randomUUID();
      await conexion.query(
        `INSERT INTO rol (id, codigo, nombre, empresa_id, activo, es_sistema, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, NOW(3), NOW(3))`,
        [rolId, nombre, nombre, empresaA],
      );

      const usuarioId = await crearUsuario(`SINROL-${SUFIJO}`);
      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: { usuario_id: usuarioId, rol_id: rolId },
      });

      expect(respuesta.estado).toBe(400);
      expect(JSON.stringify(respuesta.cuerpo)).toContain('desactivado');
    });
  });

  describe('2. La membresía es de esta empresa y de esta persona', () => {
    it('no se puede dar de alta dos veces al mismo usuario', async () => {
      const nombre = `DOBLE-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);

      const [fila] = await consultar(
        conexion,
        'SELECT usuario_id FROM usuario_empresa WHERE empresa_id = ? AND deleted_at IS NULL AND usuario_id IN (SELECT id FROM usuarios WHERE usuario = ?)',
        [empresaA, nombre],
      );

      const respuesta = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: {
          usuario_id: fila.usuario_id,
          rol_id: await idDeRol('EMPLEADO'),
        },
      });

      expect(respuesta.estado).toBe(409);
      expect(JSON.stringify(respuesta.cuerpo)).toContain('ya es miembro');
    });

    it('quien se dio de baja puede volver a entrar', async () => {
      // El único está sobre `empresa_usuario_vigente`, que vale NULL en la fila dada de
      // baja. Sin eso, un empleado que se fuera y volviera no podría volver a entrar.
      const nombre = `VUELVE-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'EMPLEADO')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      expect(
        (await llamar(app, 'DELETE', `/membresias/${id}`, { token: admin }))
          .estado,
      ).toBe(204);

      const [fila] = await consultar(
        conexion,
        'SELECT usuario_id FROM usuario_empresa WHERE id = ?',
        [id],
      );
      const regreso = await llamar(app, 'POST', '/membresias', {
        token: admin,
        cuerpo: {
          usuario_id: fila.usuario_id,
          rol_id: await idDeRol('EMPLEADO'),
        },
      });

      expect(regreso.estado).toBe(201);
    });

    it('la baja es lógica: la fila se conserva', async () => {
      // Se conserva porque la auditoría la apunta, y porque "en qué momento dejó esta
      // persona de trabajar aquí" es una pregunta de negocio, no un `404`.
      const nombre = `LOGICA-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'EMPLEADO')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      await llamar(app, 'DELETE', `/membresias/${id}`, { token: admin });

      const [fila] = await consultar(
        conexion,
        'SELECT deleted_at FROM usuario_empresa WHERE id = ?',
        [id],
      );
      expect(fila.deleted_at).not.toBeNull();
    });

    it('`usuario_id` no se puede cambiar', async () => {
      // La membresía ES la relación. Moverla sería crear otra relación distinta con el
      // mismo id, y la auditoría dejaría de poder fiarse de esa fila.
      const nombre = `FIJO-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      const respuesta = await llamar(app, 'PATCH', `/membresias/${id}`, {
        token: admin,
        cuerpo: { usuario_id: usuarioAdmin },
      });

      expect(respuesta.estado).toBe(400);
    });
  });

  describe('3. Los bloqueos que evitan dejar la empresa inservible', () => {
    it('no se puede cambiar el rol propio', async () => {
      const id = await idDeMembresia(USUARIO_ADMIN_PRUEBA);

      const respuesta = await llamar(app, 'PATCH', `/membresias/${id}`, {
        token: admin,
        cuerpo: { rol_id: await idDeRol('RRHH') },
      });

      expect(respuesta.estado).toBe(409);
      expect(JSON.stringify(respuesta.cuerpo)).toContain('tu propio rol');
    });

    it('no se puede desactivar ni dar de baja la membresía propia', async () => {
      const id = await idDeMembresia(USUARIO_ADMIN_PRUEBA);

      expect(
        (
          await llamar(app, 'PATCH', `/membresias/${id}`, {
            token: admin,
            cuerpo: { activo: false },
          })
        ).estado,
      ).toBe(409);
      expect(
        (await llamar(app, 'DELETE', `/membresias/${id}`, { token: admin }))
          .estado,
      ).toBe(409);
    });

    it('no se puede incluir la membresía propia en un cambio en bloque', async () => {
      const propia = await idDeMembresia(USUARIO_ADMIN_PRUEBA);
      const otra = await crearMembresia(`LOTE-PROPIA-${SUFIJO}`, 'EMPLEADO');
      const idOtra = (otra.cuerpo as { id: string }).id;

      const respuesta = await llamar(app, 'PUT', '/membresias/roles', {
        token: admin,
        cuerpo: {
          membresia_ids: [propia, idOtra],
          rol_id: await idDeRol('RRHH'),
        },
      });

      expect(respuesta.estado).toBe(409);
    });

    /**
     * El último administrador no se puede quitar ni degradar.
     *
     * El estado que hace falta para probarlo —"queda un administrador y no soy yo"— es
     * imposible de alcanzar por la API, y precisamente por eso la regla existe: yo soy
     * administrador, no puedo tocarme, así que la empresa siempre puede quedarse con al
     * menos uno. Por eso el PREPARATIVO va por SQL y lo que se comprueba es la API.
     *
     * Se le concede `usuario.actualizar` al rol RRHH de la empresa A solo durante la
     * prueba, para que quien actúe NO sea el administrador que queda. Si actuara el propio
     * administrador, la comprobación que se dispararía sería la de "no te toques", que ya
     * hay otra prueba, y esta no probaría nada.
     */
    it('no se puede quitar ni degradar al único administrador', async () => {
      const nombre = `ULTIMOADMIN-${SUFIJO}`;
      const alta = await crearMembresia(nombre, 'ADMIN_EMPRESA');
      expect(alta.estado).toBe(201);
      const idUltimo = (alta.cuerpo as { id: string }).id;

      // `prueba_admin` pasa a RRHH por SQL, y el rol RRHH recibe `usuario.actualizar`.
      const idAdmin = await idDeMembresia(USUARIO_ADMIN_PRUEBA);
      await conexion.query(
        'UPDATE usuario_empresa SET rol_id = ? WHERE id = ?',
        [await idDeRol('RRHH'), idAdmin],
      );

      try {
        await conPermisos(
          await idDeRol('RRHH'),
          ['usuario.actualizar', 'usuario.eliminar'],
          async (token) => {
            // Ahora la empresa tiene un único administrador, y no es quien llama.
            const [estado] = await consultar(
              conexion,
              `SELECT COUNT(*) AS n FROM usuario_empresa ue
                 JOIN rol r ON r.id = ue.rol_id
                WHERE ue.empresa_id = ? AND ue.activo = 1 AND ue.deleted_at IS NULL
                  AND r.codigo = 'ADMIN_EMPRESA'`,
              [empresaA],
            );
            expect(Number(estado.n)).toBe(1);

            for (const [que, cuerpo] of [
              ['degradar', { rol_id: await idDeRol('RRHH') }],
              ['desactivar', { activo: false }],
            ] as const) {
              const respuesta = await llamar(
                app,
                'PATCH',
                `/membresias/${idUltimo}`,
                { token, cuerpo },
              );
              expect(respuesta.estado, `${que} al último administrador`).toBe(
                409,
              );
              // Sin tilde: los mensajes que ve el cliente se escriben sin ellas en este
              // proyecto, asi que la asercion compara contra el texto real.
              expect(JSON.stringify(respuesta.cuerpo)).toContain(
                'unico administrador',
              );
            }

            expect(
              (
                await llamar(app, 'DELETE', `/membresias/${idUltimo}`, {
                  token,
                })
              ).estado,
            ).toBe(409);

            // Y en bloque tampoco, que es el caso que de verdad lo dejaría inservible.
            expect(
              (
                await llamar(app, 'PUT', '/membresias/roles', {
                  token,
                  cuerpo: {
                    membresia_ids: [idUltimo],
                    rol_id: await idDeRol('RRHH'),
                  },
                })
              ).estado,
            ).toBe(409);
          },
        );
      } finally {
        await conexion.query(
          'UPDATE usuario_empresa SET rol_id = ? WHERE id = ?',
          [await idDeRol('ADMIN_EMPRESA'), idAdmin],
        );
      }
    });

    it('con dos administradores sí se puede degradar a uno', async () => {
      // Si no, no habría forma de relevar a nadie sin pasar por un estado del que no se
      // puede volver.
      const nombre = `SEGUNDOADMIN-${SUFIJO}`;
      const alta = await crearMembresia(nombre, 'ADMIN_EMPRESA');
      expect(alta.estado).toBe(201);

      const respuesta = await llamar(
        app,
        'PATCH',
        `/membresias/${(alta.cuerpo as { id: string }).id}`,
        { token: admin, cuerpo: { rol_id: await idDeRol('RRHH') } },
      );

      expect(respuesta.estado).toBe(200);
      expect((respuesta.cuerpo as { rol: { codigo: string } }).rol.codigo).toBe(
        'RRHH',
      );
    });
  });

  describe('4. Cambio de rol', () => {
    it('cambiar el rol surte efecto en la sesión siguiente', async () => {
      const nombre = `EFECTO-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'EMPLEADO')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      // EMPLEADO lee, pero no escribe: crear un departamento es 403.
      const antes = await llamar(app, 'POST', '/departamentos', {
        token: await iniciarSesion(app, empresaA, nombre),
        cuerpo: { codigo: `EFECTO-${SUFIJO}`, nombre: 'No debe entrar' },
      });
      expect(antes.estado).toBe(403);

      await llamar(app, 'PATCH', `/membresias/${id}`, {
        token: admin,
        cuerpo: { rol_id: await idDeRol('RRHH') },
      });

      const despues = await llamar(app, 'POST', '/departamentos', {
        token: await iniciarSesion(app, empresaA, nombre),
        cuerpo: { codigo: `EFECTO-${SUFIJO}`, nombre: 'Ahora sí' },
      });
      expect(despues.estado).toBe(201);

      const baja = await llamar(
        app,
        'DELETE',
        `/departamentos/${(despues.cuerpo as { id: string }).id}`,
        { token: admin },
      );
      expect(baja.estado).toBe(204);
    });

    it('cambiar el rol se audita como `CAMBIO_ROL`, no como `ACTUALIZAR`', async () => {
      const nombre = `AUDITA-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      await llamar(app, 'PATCH', `/membresias/${id}`, {
        token: admin,
        cuerpo: { rol_id: await idDeRol('EMPLEADO') },
      });

      const eventos = await consultar(
        conexion,
        "SELECT accion, datos_antes, datos_despues FROM auditoria WHERE entidad = 'usuario_empresa' AND entidad_id = ? AND accion = 'CAMBIO_ROL'",
        [id],
      );

      // Un `ACTUALIZAR` obligaría a comparar fila a fila para saber qué pasó, y la
      // pregunta "quién ganó acceso a qué y cuándo" se llevaría todas las filas.
      expect(eventos).toHaveLength(1);
      expect(JSON.stringify(eventos[0].datos_antes)).toContain('RRHH');
      expect(JSON.stringify(eventos[0].datos_despues)).toContain('EMPLEADO');
    });

    it('reasignar varias membresías de golpe es una sola auditoría', async () => {
      const uno = await crearMembresia(`LOTE1-${SUFIJO}`, 'EMPLEADO');
      const dos = await crearMembresia(`LOTE2-${SUFIJO}`, 'EMPLEADO');
      expect(uno.estado).toBe(201);
      expect(dos.estado).toBe(201);

      const respuesta = await llamar(app, 'PUT', '/membresias/roles', {
        token: admin,
        cuerpo: {
          membresia_ids: [
            (uno.cuerpo as { id: string }).id,
            (dos.cuerpo as { id: string }).id,
          ],
          rol_id: await idDeRol('RRHH'),
        },
      });

      expect(respuesta.estado).toBe(200);
      // Un cambio en bloque devuelve un ARRAY, no un envoltorio con `datos`: no es un
      // listado paginado y no lo va a ser, porque el tamaño lo fija el lote que se mando.
      const datos = respuesta.cuerpo as { rol: { codigo: string } }[];
      expect(datos).toHaveLength(2);
      expect(datos.every((m) => m.rol.codigo === 'RRHH')).toBe(true);

      const eventos = await consultar(
        conexion,
        "SELECT datos_despues FROM auditoria WHERE entidad = 'usuario_empresa' AND accion = 'CAMBIO_ROL' AND datos_despues LIKE ?",
        [`%LOTE1-${SUFIJO}%`],
      );
      expect(eventos).toHaveLength(1);
    });

    it('una membresía ajena en el lote es 404 y no se toca ninguna', async () => {
      const propia = await crearMembresia(`LOTE3-${SUFIJO}`, 'EMPLEADO');
      expect(propia.estado).toBe(201);
      const idPropia = (propia.cuerpo as { id: string }).id;

      const [ajena] = await consultar(
        conexion,
        'SELECT id FROM usuario_empresa WHERE empresa_id = ? AND deleted_at IS NULL LIMIT 1',
        [empresaB],
      );

      const respuesta = await llamar(app, 'PUT', '/membresias/roles', {
        token: admin,
        cuerpo: {
          membresia_ids: [idPropia, ajena.id],
          rol_id: await idDeRol('RRHH'),
        },
      });

      expect(respuesta.estado).toBe(404);

      // Y lo importante: la membresía propia se quedó donde estaba. Un 404 a mitad de un
      // lote no puede haber aplicado la mitad buena.
      const consulta = await llamar(app, 'GET', `/membresias/${idPropia}`, {
        token: admin,
      });
      expect((consulta.cuerpo as { rol: { codigo: string } }).rol.codigo).toBe(
        'EMPLEADO',
      );
    });

    it('un lote vacío es 400', async () => {
      // Sin `ArrayMinSize`, una lista vacía sería un `UPDATE` que no toca nada y un evento
      // de auditoría sin contenido: ruido que parece un cambio.
      const respuesta = await llamar(app, 'PUT', '/membresias/roles', {
        token: admin,
        cuerpo: { membresia_ids: [], rol_id: await idDeRol('RRHH') },
      });

      expect(respuesta.estado).toBe(400);
    });
  });

  describe('5. Permisos, filtro y estados', () => {
    it('un rol sin `usuario.leer` no puede listar', async () => {
      // El rol EMPLEADO de la empresa B no tiene ningún permiso de `usuario.*`.
      expect(
        (
          await llamar(app, 'GET', '/membresias', {
            token: await tokenEmpleado(app),
          })
        ).estado,
      ).toBe(403);
    });

    it('sin token es 401', async () => {
      expect((await llamar(app, 'GET', '/membresias')).estado).toBe(401);
    });

    it('`incluir_inactivos` filtra las membresías desactivadas', async () => {
      const nombre = `OFF-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'EMPLEADO')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      await llamar(app, 'PATCH', `/membresias/${id}`, {
        token: admin,
        cuerpo: { activo: false },
      });

      const normales = await llamar(app, 'GET', '/membresias?por_pagina=100', {
        token: admin,
      });
      expect(
        (
          normales.cuerpo as { datos: { usuario: { usuario: string } }[] }
        ).datos.map((m) => m.usuario.usuario),
      ).not.toContain(nombre);

      const conInactivos = await llamar(
        app,
        'GET',
        '/membresias?por_pagina=100&incluir_inactivos=true',
        { token: admin },
      );
      expect(
        (
          conInactivos.cuerpo as { datos: { usuario: { usuario: string } }[] }
        ).datos.map((m) => m.usuario.usuario),
      ).toContain(nombre);
    });

    it('buscar encuentra por nombre de usuario', async () => {
      const nombre = `BUSCA-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);

      const respuesta = await llamar(
        app,
        'GET',
        `/membresias?buscar=${nombre}`,
        { token: admin },
      );

      expect(respuesta.estado).toBe(200);
      const datos = (
        respuesta.cuerpo as { datos: { usuario: { usuario: string } }[] }
      ).datos;
      expect(datos).toHaveLength(1);
      expect(datos[0].usuario.usuario).toBe(nombre);
    });

    it('la respuesta trae el rol y el usuario anidados', async () => {
      const nombre = `FORMA-${SUFIJO}`;
      expect((await crearMembresia(nombre, 'RRHH')).estado).toBe(201);
      const id = await idDeMembresia(nombre);

      const respuesta = await llamar(app, 'GET', `/membresias/${id}`, {
        token: admin,
      });

      expect(respuesta.estado).toBe(200);
      const cuerpo = respuesta.cuerpo as {
        id: string;
        activo: boolean;
        usuario: { usuario: string };
        rol: { codigo: string; nombre: string };
      };
      expect(cuerpo.activo).toBe(true);
      expect(cuerpo.usuario.usuario).toBe(nombre);
      expect(cuerpo.rol.codigo).toBe('RRHH');
    });
  });
});
