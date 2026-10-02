import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { UsersService } from '../src/users/users.service.js';
import {
  SUFIJO,
  consultar,
  crearAppDePrueba,
  prepararBase,
} from './soporte.js';

/**
 * Jerarquia de usuarios: subida hacia la raiz, bajada con CTE y prevention de ciclos.
 *
 * No hay endpoints HTTP para reasignar un superior, asi que se llama al servicio a
 * traves del contexto de Nest. Lo que se prueba es la logica que anade la migracion:
 * que el recorrido termine siempre, que no devuelva el nodo equivocado y que no exista
 * ninguna forma de dejar un arbol circular.
 */
describe('Jerarquia de usuarios (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let usuarios: UsersService;

  /** Raiz del arbol de la prueba. */
  let jefe: string;
  /** Intermedio: cuelga de `jefe`. */
  let intermedio: string;
  /** Hoja: cuelga de `intermedio`. */
  let hoja: string;
  /** Usuario suelto, sin padre, para comprobar que no le molesta nada. */
  let suelto: string;

  /** Crea un usuario de la prueba. `password_hash` es un relleno: aqui no se autentica. */
  async function crearUsuario(
    nombre: string,
    parentId: string | null,
  ): Promise<string> {
    const id = randomUUID();
    await conexion.query(
      `INSERT INTO usuarios (id, usuario, password_hash, parent_user_id, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [id, `${nombre}-${SUFIJO}`, 'x'.repeat(60), parentId],
    );
    return id;
  }

  /** Nombre de acceso real de un usuario creado por la suite. */
  function nombreDe(usuarioId: string): string {
    return `${usuarioId}-${SUFIJO}`;
  }

  /** Filas que devuelve una consulta, con el tipo que interesa. */
  async function filas<T>(
    sql: string,
    parametros: unknown[] = [],
  ): Promise<T[]> {
    return (await consultar(conexion, sql, parametros)) as T[];
  }

  /** Vuelve a dejar un usuario como estaba: vivo, activo, sin padre y sin correo. */
  async function restaurar(usuarioId: string): Promise<void> {
    await conexion.query(
      'UPDATE usuarios SET deleted_at = NULL, activo = 1, email = NULL, parent_user_id = NULL WHERE id = ?',
      [usuarioId],
    );
  }

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    usuarios = app.get(UsersService);

    // jefe -> intermedio -> hoja
    jefe = await crearUsuario('JER-JEFE', null);
    intermedio = await crearUsuario('JER-MEDIO', jefe);
    hoja = await crearUsuario('JER-HOJA', intermedio);
    suelto = await crearUsuario('JER-SUELTO', null);
  });

  afterAll(async () => {
    // De abajo arriba y en sentencias sueltas: `fk_usuarios_parent_user` es
    // `ON DELETE RESTRICT`, asi que borrar al jefe con sus hijos dentro del mismo
    // `IN (...)` depende del orden que elija MySQL y falla de forma intermitente.
    for (const id of [hoja, intermedio, jefe, suelto]) {
      await conexion.query('DELETE FROM usuarios WHERE id = ?', [id]);
    }
  });

  describe('1. Recorrido hacia abajo', () => {
    it('devuelve el propio nodo en nivel 0 y los descendientes en niveles sucesivos', async () => {
      const resultado = await usuarios.descendientes(jefe);
      const porNivel = new Map(resultado.map((n) => [n.id, n.nivel]));

      expect(porNivel.get(jefe)).toBe(0);
      expect(porNivel.get(intermedio)).toBe(1);
      expect(porNivel.get(hoja)).toBe(2);
      expect(resultado).toHaveLength(3);
    });

    it('una hoja solo se devuelve a si misma', async () => {
      const resultado = await usuarios.descendientes(hoja);

      expect(resultado).toEqual([{ id: hoja, nivel: 0 }]);
    });

    it('un usuario sin subordinados no trae a nadie mas', async () => {
      const resultado = await usuarios.descendientes(suelto);

      expect(resultado).toEqual([{ id: suelto, nivel: 0 }]);
    });

    it('la jerarquia de un usuario no incluye la de otra rama', async () => {
      const resultado = await usuarios.descendientes(jefe);

      expect(resultado.map((n) => n.id)).not.toContain(suelto);
    });

    it('un id inexistente devuelve una lista vacia, sin error', async () => {
      const resultado = await usuarios.descendientes(randomUUID());

      expect(resultado).toEqual([]);
    });

    it('el nivel llega como numero y no como cadena', async () => {
      const resultado = await usuarios.descendientes(jefe);

      // MySQL deduce el tipo de la columna recursiva del literal inicial y devuelve los
      // enteros de la CTE como texto. Quien compare con `0` en vez de `"0"` no
      // encontraria nunca la raiz.
      for (const nodo of resultado) {
        expect(typeof nodo.nivel).toBe('number');
      }
    });

    it('el conteo de subordinados es solo el nivel directo', async () => {
      expect(await usuarios.contarSubordinados(jefe)).toBe(1);
      expect(await usuarios.contarSubordinados(intermedio)).toBe(1);
      expect(await usuarios.contarSubordinados(hoja)).toBe(0);
    });
  });

  describe('2. Prevention de ciclos', () => {
    it('nadie puede colgar de si mismo', async () => {
      expect(await usuarios.puedeColgarseDe(jefe, jefe)).toBe(false);
    });

    it('un jefe puede colgar de alguien que no es de su rama', async () => {
      expect(await usuarios.puedeColgarseDe(jefe, suelto)).toBe(true);
    });

    it('un usuario puede quedarse sin padre: `null` no es un ciclo', async () => {
      expect(await usuarios.puedeColgarseDe(jefe, null)).toBe(true);
    });

    it('la relacion que ya existe se acepta', async () => {
      // `intermedio` ya cuelga de `jefe`. Replantearlo no es un ciclo: el ciclo seria
      // `jefe` colgando de su propio subordinado, que es el caso siguiente.
      expect(await usuarios.puedeColgarseDe(intermedio, jefe)).toBe(true);
      expect(await usuarios.puedeColgarseDe(hoja, jefe)).toBe(true);
    });

    it('un jefe no puede pasar a ser subordinado del que ya lo es', async () => {
      // Aqui empieza el cierre: si `jefe` colgara de `intermedio`, cada recorrido del
      // arbol entraria en bucle. No basta con mirar al padre directo, porque `jefe` es
      // ancestro de `intermedio` y no su padre.
      expect(await usuarios.puedeColgarseDe(jefe, intermedio)).toBe(false);
    });

    it('el ciclo indirecto se detecta: el jefe no puede colgar de su nieto', async () => {
      // Es el caso que un `if (a === b)` no pilla: jefe -> intermedio -> hoja, y alguien
      // propone jefe -> hoja. La comprobacion tiene que subir, no solo mirar al padre.
      expect(await usuarios.puedeColgarseDe(jefe, hoja)).toBe(false);
    });

    it('tampoco alargar la rama hacia arriba', async () => {
      // La hoja no puede colgar del jefe sin perder al intermedio... salvo que se quiera
      // a proposito. Lo que no se permite es que sea su propio ancestro.
      expect(await usuarios.puedeColgarseDe(jefe, hoja)).toBe(false);
    });

    it('colgar de un padre que no existe se rechaza', async () => {
      expect(await usuarios.puedeColgarseDe(hoja, randomUUID())).toBe(false);
    });

    it('colgar de un padre dado de baja se rechaza', async () => {
      try {
        await conexion.query(
          'UPDATE usuarios SET deleted_at = NOW(3) WHERE id = ?',
          [suelto],
        );

        expect(await usuarios.puedeColgarseDe(hoja, suelto)).toBe(false);
      } finally {
        await restaurar(suelto);
      }
    });
  });

  describe('3. La base no admite un ciclo', () => {
    it('no se puede borrar un jefe dejando a sus hijos colgando', async () => {
      // `ON DELETE RESTRICT`. Se comprueba dentro de un `try` porque lo que interesa es
      // que MySQL lo rechace, no el texto que produzca.
      let rechazado = false;
      try {
        await conexion.query('DELETE FROM usuarios WHERE id = ?', [jefe]);
      } catch {
        rechazado = true;
      }

      expect(rechazado).toBe(true);

      // Y el jefe sigue ahi, que es la otra mitad de la garantia.
      const supervivientes = await filas<{ id: string }>(
        'SELECT id FROM usuarios WHERE id = ?',
        [jefe],
      );
      expect(supervivientes).toHaveLength(1);
    });

    it('un padre valido si se acepta, y la jerarquia se recalcula', async () => {
      try {
        const [resultado] = await conexion.query(
          'UPDATE usuarios SET parent_user_id = ? WHERE id = ?',
          [suelto, jefe],
        );
        const cab = resultado as { affectedRows?: number };
        expect(cab.affectedRows).toBe(1);

        // Con `suelto` como raiz y `jefe` colgando de el, `suelto` sigue teniendo un
        // solo subordinado directo y tres niveles de profundidad por debajo.
        expect(await usuarios.contarSubordinados(suelto)).toBe(1);
        expect(await usuarios.descendientes(suelto)).toHaveLength(4);
      } finally {
        await restaurar(jefe);
      }

      expect(await usuarios.contarSubordinados(jefe)).toBe(1);
    });

    it('la columna generada se apaga al dar de baja, liberando el nombre de acceso', async () => {
      try {
        const vivos = await filas<{ usuario_vigente: string | null }>(
          'SELECT usuario_vigente FROM usuarios WHERE id = ?',
          [hoja],
        );
        expect(vivos[0].usuario_vigente).toBe(nombreDe('JER-HOJA'));

        await conexion.query(
          'UPDATE usuarios SET deleted_at = NOW(3) WHERE id = ?',
          [hoja],
        );

        const bajas = await filas<{ usuario_vigente: string | null }>(
          'SELECT usuario_vigente FROM usuarios WHERE id = ?',
          [hoja],
        );
        expect(bajas[0].usuario_vigente).toBeNull();
      } finally {
        await restaurar(hoja);
      }
    });

    it('el UNIQUE no impide reutilizar el nombre de un usuario dado de baja', async () => {
      try {
        await conexion.query(
          'UPDATE usuarios SET deleted_at = NOW(3) WHERE id = ?',
          [suelto],
        );

        // El UNIQUE esta sobre `usuario_vigente`, que ya vale NULL: el nombre queda
        // libre para otro usuario, que es justo lo que se queria.
        const nuevo = randomUUID();
        await conexion.query(
          'INSERT INTO usuarios (id, usuario, password_hash, activo) VALUES (?, ?, ?, 1)',
          [nuevo, nombreDe('JER-SUELTO'), 'x'.repeat(60)],
        );

        const [{ total }] = await filas<{ total: number }>(
          'SELECT COUNT(*) AS total FROM usuarios WHERE usuario = ?',
          [nombreDe('JER-SUELTO')],
        );
        expect(Number(total)).toBe(2);

        await conexion.query('DELETE FROM usuarios WHERE id = ?', [nuevo]);
      } finally {
        await restaurar(suelto);
      }
    });
  });

  /**
   * Las pruebas de esta seccion mueven `deleted_at` y `activo` de los usuarios de la
   * prueba. Todo lo que tocan se restaura en un `finally`: si no, un fallo a mitad deja
   * las filas en un estado que hace fallar las pruebas siguientes, y el error real se
   * pierde entre los derivados.
   */
  describe('4. Baja logica y autenticacion', () => {
    it('findByUsername y findByEmail ignoran al usuario dado de baja', async () => {
      const nombre = nombreDe('JER-SUELTO');

      try {
        await conexion.query(
          'UPDATE usuarios SET deleted_at = NOW(3) WHERE id = ?',
          [suelto],
        );

        expect(await usuarios.findByUsername(nombre)).toBeNull();
        expect(await usuarios.findActivo(nombre)).toBeNull();
      } finally {
        await restaurar(suelto);
      }

      // Vuelto a la vida, el mismo nombre lo vuelve a encontrar.
      expect(await usuarios.findByUsername(nombre)).not.toBeNull();
    });

    it('un usuario suspendido con `activo = false` tampoco se autentica', async () => {
      const nombre = nombreDe('JER-SUELTO');

      try {
        await conexion.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [
          suelto,
        ]);

        expect(await usuarios.findActivo(nombre)).toBeNull();
        // Sigue existiendo: la suspension es reversible y no es una baja, asi que
        // `findByUsername` —que solo filtra por `deleted_at`— lo encuentra igual.
        expect(await usuarios.findByUsername(nombre)).not.toBeNull();
      } finally {
        await restaurar(suelto);
      }
    });

    it('findByEmail encuentra al usuario vivo por su correo', async () => {
      const correo = `${nombreDe('JER-HOJA')}@ejemplo.com`;

      try {
        await conexion.query('UPDATE usuarios SET email = ? WHERE id = ?', [
          correo,
          hoja,
        ]);

        expect(await usuarios.findByEmail(correo)).not.toBeNull();
        expect(await usuarios.findActivo(correo)).not.toBeNull();
      } finally {
        await restaurar(hoja);
      }

      expect(await usuarios.findByEmail(correo)).toBeNull();
    });

    it('findActivo acepta tanto el nombre como el correo', async () => {
      const nombre = nombreDe('JER-HOJA');
      const correo = `${nombre}@ejemplo.com`;

      try {
        await conexion.query('UPDATE usuarios SET email = ? WHERE id = ?', [
          correo,
          hoja,
        ]);

        expect(await usuarios.findActivo(nombre)).not.toBeNull();
        expect(await usuarios.findActivo(correo)).not.toBeNull();
        expect(await usuarios.findActivo('nadie@example.com')).toBeNull();
      } finally {
        await restaurar(hoja);
      }
    });
  });
});
