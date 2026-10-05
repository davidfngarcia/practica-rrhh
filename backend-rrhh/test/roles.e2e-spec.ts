/**
 * Roles y permisos (e2e).
 *
 * Lo que importa aqui no es tanto el CRUD como el aislamiento: que un rol creado en una
 * empresa no aparezca en el listado de otra, y que un UUID de rol ajeno no se pueda ni
 * leer ni modificar. Sin esas dos comprobaciones, "los roles son por empresa" seria una
 * frase del comentario y nada mas.
 */
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  abrirConexion,
  conPermisosTemporales,
  consultar,
  crearAppDePrueba,
  iniciarSesion,
  llamar,
  prepararBase,
  SUFIJO,
} from './soporte.js';
import { IDS_PRUEBA, USUARIO_ADMIN_PRUEBA } from '../src/database/semilla.js';

const { empresaA, empresaB, membresiaB } = IDS_PRUEBA;

describe('Roles y permisos (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let admin: string;
  let adminB: string;

  /** Ids de los roles que crea la suite, para borrarlos al terminar. */
  const creados: string[] = [];

  beforeAll(async () => {
    await prepararBase();
    app = await crearAppDePrueba();
    conexion = await abrirConexion();
    admin = await iniciarSesion(app, empresaA, USUARIO_ADMIN_PRUEBA);
    adminB = await iniciarSesion(app, empresaB, USUARIO_ADMIN_PRUEBA);
  });

  afterAll(async () => {
    // La suite crea los roles por la API, asi que cada alta queda auditada. Como aqui se
    // borran filas de verdad, su auditoria se va con ellas: dejarla apuntando a un rol
    // inexistente rompe el invariante que comprueba `catalogos.e2e-spec.ts`. Es el mismo
    // criterio que usa `tmp-verif/limpiar-sufijo.mjs`.
    //
    // El orden va de mas restrictivo a menos: `rol_permiso` cuelga del rol, y la
    // auditoria se filtra por `entidad = 'rol'` para no tocar la de otras tablas.
    for (const id of creados) {
      await conexion.query('DELETE FROM rol_permiso WHERE rol_id = ?', [id]);
      await conexion.query(
        "DELETE FROM auditoria WHERE entidad = 'rol' AND entidad_id = ?",
        [id],
      );
      // Borrado directo, sin tocar `deleted_at`. Una de las pruebas da de baja un rol y
      // crea otro con el mismo codigo justo despues, y `empresa_codigo_vigente` —que vale
      // NULL en las filas dadas de baja— es lo que libera el codigo. Si aqui se
      // resucitara la fila antes de borrarla, esa columna volveria a tener valor y el
      // borrado chocaria con el indice unico.
      await conexion.query('DELETE FROM rol WHERE id = ?', [id]);
    }
    await app.close();
    await conexion.end();
  });

  /**
   * Crea un rol por API y devuelve la respuesta.
   *
   * El token va como parametro y no fijo dentro, porque varias comprobaciones necesitan
   * crear el rol en la empresa B. Con el token de A hardcodeado, el test de aislamiento
   * habria creado el rol en A y "buscalo desde B" no habria probado nada.
   */
  async function crearRol(
    token: string,
    codigo: string,
    permisos: string[] = [],
  ) {
    const respuesta = await llamar(app, 'POST', '/roles', {
      token,
      cuerpo: {
        codigo,
        nombre: `Rol ${codigo}`,
        descripcion: `Creado por la suite ${SUFIJO}`,
        permisos,
      },
    });

    if (respuesta.estado === 201) {
      creados.push((respuesta.cuerpo as { id: string }).id);
    }
    return respuesta;
  }

  /** Id de un cuerpo de respuesta de alta. */
  function idDe(respuesta: { cuerpo: unknown }): string {
    return (respuesta.cuerpo as { id: string }).id;
  }

  /** Codigos del listado de roles que devuelve la respuesta. */
  function codigosDe(respuesta: { cuerpo: unknown }): string[] {
    return (respuesta.cuerpo as { datos: { codigo: string }[] }).datos.map(
      (r) => r.codigo,
    );
  }

  describe('1. Listado y aislamiento entre empresas', () => {
    it('el listado solo trae roles de la empresa de la sesion', async () => {
      const codigo = `AISLE-${SUFIJO}`;
      expect((await crearRol(admin, codigo)).estado).toBe(201);

      const enA = await llamar(app, 'GET', '/roles?por_pagina=100', {
        token: admin,
      });
      expect(enA.estado).toBe(200);
      expect(codigosDe(enA)).toContain(codigo);

      const enB = await llamar(app, 'GET', '/roles?por_pagina=100', {
        token: adminB,
      });
      expect(codigosDe(enB)).not.toContain(codigo);
    });

    it('el mismo codigo se puede crear en dos empresas distintas', async () => {
      // Es el motivo de mover `empresa_id` a `rol`. Con el catalogo global, la segunda
      // empresa recibia un 409 de duplicado por un rol que era suyo.
      const codigo = `COMUN-${SUFIJO}`;

      expect((await crearRol(admin, codigo)).estado).toBe(201);
      expect((await crearRol(adminB, codigo)).estado).toBe(201);
    });

    it('un UUID de rol de otra empresa responde 404, no 403', async () => {
      // 404 y no 403: si fuera 403, un cliente podria enumerar UUIDs y deducir cuales
      // existen en otras empresas.
      const enB = await crearRol(adminB, `AJENO-${SUFIJO}`);
      expect(enB.estado).toBe(201);
      const ajeno = idDe(enB);

      const lectura = await llamar(app, 'GET', `/roles/${ajeno}`, {
        token: admin,
      });
      expect(lectura.estado).toBe(404);

      const escritura = await llamar(app, 'PATCH', `/roles/${ajeno}`, {
        token: admin,
        cuerpo: { nombre: 'Secuestro de rol' },
      });
      expect(escritura.estado).toBe(404);

      const baja = await llamar(app, 'DELETE', `/roles/${ajeno}`, {
        token: admin,
      });
      expect(baja.estado).toBe(404);
    });

    it('un rol de plantilla no es accesible por su id', async () => {
      // Las plantillas tienen `empresa_id IS NULL`. No hay ninguna ruta que las exponga;
      // se comprueba por id por si algun listado las filtrara sin querer.
      const [plantilla] = await consultar(
        conexion,
        'SELECT id FROM rol WHERE es_sistema = 1 AND empresa_id IS NULL AND codigo = ? LIMIT 1',
        ['EMPLEADO'],
      );

      const respuesta = await llamar(app, 'GET', `/roles/${plantilla.id}`, {
        token: admin,
      });
      expect(respuesta.estado).toBe(404);
    });

    it('el catalogo de permisos es global e igual para todos', async () => {
      const respuesta = await llamar(app, 'GET', '/roles/permisos', {
        token: admin,
      });
      expect(respuesta.estado).toBe(200);

      const codigos = (respuesta.cuerpo as { codigo: string }[]).map(
        (p) => p.codigo,
      );
      expect(codigos).toContain('rol.leer');
      expect(codigos).toContain('rol.crear');
      expect(codigos).toContain('empleado.eliminar');

      const enB = await llamar(app, 'GET', '/roles/permisos', {
        token: adminB,
      });
      expect((enB.cuerpo as { codigo: string }[]).map((p) => p.codigo)).toEqual(
        codigos,
      );
    });
  });

  describe('2. Permisos del rol', () => {
    it('un rol nace con los permisos que se piden', async () => {
      const alta = await crearRol(admin, `PERM-${SUFIJO}`, [
        'departamento.leer',
        'departamento.crear',
      ]);

      expect(alta.estado).toBe(201);
      expect((alta.cuerpo as { permisos: string[] }).permisos.sort()).toEqual([
        'departamento.crear',
        'departamento.leer',
      ]);
    });

    it('PUT sobre /permisos sustituye el conjunto, no lo anade', async () => {
      const alta = await crearRol(admin, `PUT-${SUFIJO}`, [
        'departamento.leer',
        'puesto.leer',
      ]);
      const id = idDe(alta);

      const respuesta = await llamar(app, 'PUT', `/roles/${id}/permisos`, {
        token: admin,
        cuerpo: { permisos: ['puesto.crear'] },
      });

      expect(respuesta.estado).toBe(200);
      // `puesto.leer` ha desaparecido. Sin esto no habria forma de quitar un permiso.
      expect((respuesta.cuerpo as { permisos: string[] }).permisos).toEqual([
        'puesto.crear',
      ]);

      const consulta = await llamar(app, 'GET', `/roles/${id}`, {
        token: admin,
      });
      expect((consulta.cuerpo as { permisos: string[] }).permisos).toEqual([
        'puesto.crear',
      ]);
    });

    it('un permiso inexistente se rechaza con 400 nombrandolo', async () => {
      const alta = await crearRol(admin, `MALA-${SUFIJO}`);
      const id = idDe(alta);

      const respuesta = await llamar(app, 'PUT', `/roles/${id}/permisos`, {
        token: admin,
        cuerpo: { permisos: ['departamento.leer', 'departamento.inventar'] },
      });

      expect(respuesta.estado).toBe(400);
      // El 400 nombra el codigo TAL COMO LLEGO, no normalizado a mayusculas: es lo
      // unico que el cliente puede comparar con lo que realmente envio.
      expect(JSON.stringify(respuesta.cuerpo)).toContain(
        'departamento.inventar',
      );

      // Y el conjunto anterior queda intacto: un 400 no debe haber aplicado la mitad.
      const consulta = await llamar(app, 'GET', `/roles/${id}`, {
        token: admin,
      });
      expect((consulta.cuerpo as { permisos: string[] }).permisos).toEqual([]);
    });

    it('los permisos de una membresia surten efecto en la sesion siguiente', async () => {
      // El guard relee los permisos en cada peticion, asi que cambiar los permisos de un
      // rol tiene que notarse sin esperar a que caduque el token.
      //
      // Se comprueba con la membresia del EMPLEADO de la empresa B, que es la que usa
      // `conPermisosTemporales`: primero sin el permiso nuevo y luego con el.
      const [membresia] = await consultar(
        conexion,
        'SELECT id, rol_id FROM usuario_empresa WHERE id = ?',
        [membresiaB],
      );
      const rolOriginal = membresia.rol_id as string;

      const alta = await crearRol(adminB, `EFECTO-${SUFIJO}`, [
        'departamento.crear',
        'departamento.eliminar',
      ]);
      const id = idDe(alta);

      await conexion.query(
        'UPDATE usuario_empresa SET rol_id = ? WHERE id = ?',
        [id, membresia.id],
      );

      try {
        const conPermiso = await iniciarSesion(app, empresaB);
        const permitido = await llamar(app, 'POST', '/departamentos', {
          token: conPermiso,
          cuerpo: { codigo: `EFECTO-${SUFIJO}`, nombre: 'Ahora si' },
        });
        expect(permitido.estado).toBe(201);

        // Se retira por la API, no con un `DELETE` de SQL. La baja de un departamento es
        // logica y ademas queda auditada, y esa es la forma que el resto del sistema
        // respeta: un borrado fisico desde las pruebas deja filas en `auditoria` apuntando
        // a un registro que ya no existe, y hay una comprobacion dedicada a que eso no
        // ocurra.
        const baja = await llamar(
          app,
          'DELETE',
          `/departamentos/${permitido.cuerpo.id}`,
          { token: conPermiso },
        );
        expect(baja.estado).toBe(204);

        // Sin permiso, el mismo endpoint responde 403.
        await conexion.query(
          'UPDATE usuario_empresa SET rol_id = ? WHERE id = ?',
          [rolOriginal, membresia.id],
        );
        const sinPermiso = await iniciarSesion(app, empresaB);
        const bloqueado = await llamar(app, 'POST', '/departamentos', {
          token: sinPermiso,
          cuerpo: { codigo: `EFECTO-${SUFIJO}`, nombre: 'No debe entrar' },
        });
        expect(bloqueado.estado).toBe(403);
      } finally {
        await conexion.query(
          'UPDATE usuario_empresa SET rol_id = ? WHERE id = ?',
          [rolOriginal, membresia.id],
        );
      }
    });
  });

  describe('3. Campos que no se pueden tocar', () => {
    it('`codigo` no se puede cambiar', async () => {
      const alta = await crearRol(admin, `FIJO-${SUFIJO}`);
      const id = idDe(alta);

      const respuesta = await llamar(app, 'PATCH', `/roles/${id}`, {
        token: admin,
        cuerpo: { codigo: `CAMBIADO-${SUFIJO}` },
      });

      expect(respuesta.estado).toBe(400);
    });

    it('`es_sistema` no se puede forzar desde la API', async () => {
      const alta = await crearRol(admin, `SIS-${SUFIJO}`);
      const id = idDe(alta);

      const respuesta = await llamar(app, 'PATCH', `/roles/${id}`, {
        token: admin,
        cuerpo: { es_sistema: true },
      });

      // 400 por propiedad no declarada: el pipe va con `forbidNonWhitelisted`.
      expect(respuesta.estado).toBe(400);

      const consulta = await llamar(app, 'GET', `/roles/${id}`, {
        token: admin,
      });
      expect((consulta.cuerpo as { es_sistema: boolean }).es_sistema).toBe(
        false,
      );
    });

    it('un rol de plantilla no se renombra', async () => {
      const [plantilla] = await consultar(
        conexion,
        'SELECT id FROM rol WHERE es_sistema = 1 AND empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaA, 'RRHH'],
      );

      const respuesta = await llamar(app, 'PATCH', `/roles/${plantilla.id}`, {
        token: admin,
        cuerpo: { nombre: 'Nombre cambiado' },
      });

      expect(respuesta.estado).toBe(409);
      expect(JSON.stringify(respuesta.cuerpo)).toContain('plantilla');
    });

    it('un rol de plantilla no se da de baja', async () => {
      const [plantilla] = await consultar(
        conexion,
        'SELECT id FROM rol WHERE es_sistema = 1 AND empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaA, 'RRHH'],
      );

      const respuesta = await llamar(app, 'DELETE', `/roles/${plantilla.id}`, {
        token: admin,
      });

      expect(respuesta.estado).toBe(409);
    });

    it('los permisos de un rol de plantilla SI se pueden ajustar', async () => {
      // `es_sistema` protege el rol, no sus permisos. Ajustarlos es justo lo que
      // justifica que cada empresa tenga su propia copia en vez de compartir la plantilla.
      const [plantilla] = await consultar(
        conexion,
        'SELECT id FROM rol WHERE es_sistema = 1 AND empresa_id = ? AND codigo = ? LIMIT 1',
        [empresaA, 'EMPLEADO'],
      );

      const antes = await consultar(
        conexion,
        'SELECT p.codigo FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE rp.rol_id = ? ORDER BY p.codigo',
        [plantilla.id],
      );
      const codigosAntes = antes.map((f) => f.codigo as string);

      try {
        const respuesta = await llamar(
          app,
          'PUT',
          `/roles/${plantilla.id}/permisos`,
          {
            token: admin,
            cuerpo: { permisos: ['empresa.leer'] },
          },
        );
        expect(respuesta.estado).toBe(200);
        expect((respuesta.cuerpo as { permisos: string[] }).permisos).toEqual([
          'empresa.leer',
        ]);
      } finally {
        // Se restaura para no dejar la base de pruebas con el rol EMPLEADO capado.
        await llamar(app, 'PUT', `/roles/${plantilla.id}/permisos`, {
          token: admin,
          cuerpo: { permisos: codigosAntes },
        });
      }
    });
  });

  describe('4. Integridad con las membresias', () => {
    it('no se desactiva un rol con usuarios dentro', async () => {
      // Desactivar expulsaria a esos usuarios en su siguiente peticion, sin aviso: el
      // guard relee los permisos cada vez.
      const [enUso] = await consultar(
        conexion,
        'SELECT r.id FROM rol r JOIN usuario_empresa ue ON ue.rol_id = r.id WHERE r.empresa_id = ? AND ue.activo = 1 AND ue.deleted_at IS NULL LIMIT 1',
        [empresaA],
      );

      const respuesta = await llamar(app, 'PATCH', `/roles/${enUso.id}`, {
        token: admin,
        cuerpo: { activo: false },
      });

      expect(respuesta.estado).toBe(409);
      expect(JSON.stringify(respuesta.cuerpo)).toContain('membresia');
    });

    it('no se da de baja un rol con usuarios dentro', async () => {
      const [enUso] = await consultar(
        conexion,
        'SELECT r.id FROM rol r JOIN usuario_empresa ue ON ue.rol_id = r.id WHERE r.empresa_id = ? AND ue.activo = 1 AND ue.deleted_at IS NULL LIMIT 1',
        [empresaA],
      );

      const respuesta = await llamar(app, 'DELETE', `/roles/${enUso.id}`, {
        token: admin,
      });

      expect(respuesta.estado).toBe(409);
    });

    it('un rol sin usuarios se puede desactivar y volver a activar', async () => {
      const alta = await crearRol(admin, `OFF-${SUFIJO}`);
      const id = idDe(alta);

      const apagado = await llamar(app, 'PATCH', `/roles/${id}`, {
        token: admin,
        cuerpo: { activo: false },
      });
      expect(apagado.estado).toBe(200);
      expect((apagado.cuerpo as { activo: boolean }).activo).toBe(false);

      const encendido = await llamar(app, 'PATCH', `/roles/${id}`, {
        token: admin,
        cuerpo: { activo: true },
      });
      expect((encendido.cuerpo as { activo: boolean }).activo).toBe(true);
    });

    it('un rol dado de baja libera el codigo', async () => {
      const codigo = `LIBRE-${SUFIJO}`;
      const alta = await crearRol(admin, codigo);
      const id = idDe(alta);

      const baja = await llamar(app, 'DELETE', `/roles/${id}`, {
        token: admin,
      });
      expect(baja.estado).toBe(204);

      // La columna generada `empresa_codigo_vigente` vale NULL en la fila dada de baja,
      // asi que el indice unico libera el codigo y se puede reutilizar.
      const respuesta = await llamar(app, 'POST', '/roles', {
        token: admin,
        cuerpo: { codigo, nombre: 'Reutilizado' },
      });
      expect(respuesta.estado).toBe(201);
    });
  });

  describe('5. Permisos de la API', () => {
    it('sin `rol.leer` el listado y el alta son 403', async () => {
      // El rol EMPLEADO no tiene ningun permiso de `rol.*`, asi que esto comprueba que
      // el guard esta leyendo de verdad y no solo exigiendo sesion.
      await conPermisosTemporales(conexion, app, [], async (token) => {
        const listado = await llamar(app, 'GET', '/roles', { token });
        const alta = await llamar(app, 'POST', '/roles', {
          token,
          cuerpo: { codigo: `X-${SUFIJO}`, nombre: 'No deberia entrar' },
        });

        expect(listado.estado).toBe(403);
        expect(alta.estado).toBe(403);
      });
    });

    it('sin token es 401', async () => {
      expect((await llamar(app, 'GET', '/roles')).estado).toBe(401);
    });

    it('`incluir_inactivos` filtra los desactivados', async () => {
      const codigo = `HIDDEN-${SUFIJO}`;
      const alta = await crearRol(admin, codigo);
      await llamar(app, 'PATCH', `/roles/${idDe(alta)}`, {
        token: admin,
        cuerpo: { activo: false },
      });

      const normales = await llamar(app, 'GET', '/roles?por_pagina=100', {
        token: admin,
      });
      expect(codigosDe(normales)).not.toContain(codigo);

      const conInactivos = await llamar(
        app,
        'GET',
        '/roles?por_pagina=100&incluir_inactivos=true',
        { token: admin },
      );
      expect(codigosDe(conInactivos)).toContain(codigo);
    });

    it('un codigo duplicado en la misma empresa es 409', async () => {
      expect((await crearRol(admin, `DUP-${SUFIJO}`)).estado).toBe(201);

      const segunda = await llamar(app, 'POST', '/roles', {
        token: admin,
        cuerpo: { codigo: `DUP-${SUFIJO}`, nombre: 'Duplicado' },
      });

      expect(segunda.estado).toBe(409);
    });
  });
});
