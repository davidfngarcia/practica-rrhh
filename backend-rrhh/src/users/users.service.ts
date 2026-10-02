import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Usuario } from '../database/entities/usuario.entity.js';

/**
 * Tope de niveles en los recorridos de jerarquia.
 *
 * No es un limite de negocio (una empresa no tiene 64 niveles de mando), es un tope de
 * seguridad: si los datos llegaran a tener un ciclo por un fallo anterior, un recorrido
 * sin tope no terminaria nunca. Cortando aqui, la consulta acaba y el problema se
 * manifiesta como una jerarquia truncada, no como un proceso colgado.
 */
const NIVEL_MAXIMO = 64;

/**
 * Consultas sobre usuarios que consume la autenticacion.
 *
 * No es todavia el CRUD de usuarios (eso llega en la fase de modulos de negocio); es lo
 * que la autenticacion necesita y lo que permite que `parent_user_id`, `deleted_at` y las
 * columnas de autor queden ya en uso.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly datos: DataSource,
  ) {}

  /**
   * Busca un usuario por su nombre de acceso entre los no dados de baja.
   *
   * Filtra por `deleted_at IS NULL` ademas de por el nombre. `uq_usuarios_usuario` esta
   * sobre la columna generada `usuario_vigente`, que vale `NULL` en las filas borradas: un
   * nombre liberado por una baja se puede volver a asignar. Sin este filtro, buscar el
   * nombre recien liberado podria devolver la fila dada de baja, que sigue ocupando el
   * valor en la columna `usuario`.
   */
  async findByUsername(nombreUsuario: string): Promise<Usuario | null> {
    return this.usuariosRepository
      .createQueryBuilder('u')
      .where('u.usuario = :nombre', { nombre: nombreUsuario })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Busca por correo entre los no dados de baja. El indice lo hace eficiente.
   *
   * Mismo criterio que `findByUsername`, por el motivo de `uq_usuarios_email` sobre
   * `email_vigente`.
   */
  async findByEmail(correo: string): Promise<Usuario | null> {
    return this.usuariosRepository
      .createQueryBuilder('u')
      .where('u.email = :correo', { correo })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
  }

  /**
   * Busca un usuario vivo por identificador o correo.
   *
   * Filtra por `deleted_at IS NULL` y no solo por `activo`: son dos cosas distintas y no
   * siempre van juntas. `activo = false` es una suspension, reversible; `deleted_at` es una
   * baja logica. Un usuario dado de baja no debe poder autenticarse aunque su `activo` se
   * hubiera quedado a true por un camino que no pasa por aqui.
   *
   * `findByUsername` y `findByEmail` si filtran tambien por baja logica: si no, un nombre
   * de acceso liberado por `uq_usuarios_usuario` podria seguir resolviendo a la fila
   * borrada, y un alta reutilizando ese nombre se solaparia con ella.
   */
  async findActivo(identificador: string): Promise<Usuario | null> {
    return this.usuariosRepository
      .createQueryBuilder('u')
      .where('u.activo = true')
      .andWhere('u.deleted_at IS NULL')
      .andWhere('(u.usuario = :d OR u.email = :d)', { d: identificador })
      .getOne();
  }

  /** Cuantos usuarios cuelgan directamente de este. */
  async contarSubordinados(usuarioId: string): Promise<number> {
    return this.usuariosRepository
      .createQueryBuilder('u')
      .where('u.parent_user_id = :usuarioId', { usuarioId })
      .getCount();
  }

  /**
   * Jerarquia completa hacia abajo desde un usuario, con una CTE recursiva.
   *
   * Devuelve los ids con su nivel de profundidad, empezando por el propio usuario, para
   * que quien lo use pueda distinguir el nodo de partida de sus descendientes.
   *
   * Va como SQL directo y no con el constructor de consultas porque esta version de
   * TypeORM no expone CTE (`withRecursive`) en su API: la alternativa es traer todo el
   * arbol a memoria y recorrerlo en TypeScript, que es exactamente lo que se quiere evitar
   * al hablar de jerarquias grandes.
   *
   * Los marcadores son posicionales (`?`) y no con nombre (`:nombre`). `DataSource.query()`
   * entrega la cadena tal cual al driver, que solo expande arrays contra `?`: un
   * marcador con nombre se cuela en MySQL tal cual y el fallo sale como un error de
   * sintaxis, muy lejos de la causa. Es una diferencia sutil con `QueryBuilder`, que si
   * los traduce.
   *
   * El tope `nivel < ?` se aplica dentro de la recursion y no al final: si se aplicase
   * fuera, MySQL habria expandido antes todo el ciclo hasta quedarse sin memoria.
   */
  async descendientes(
    usuarioId: string,
  ): Promise<{ id: string; nivel: number }[]> {
    const filas = await this.datos.query<
      { id: string; nivel: number | string }[]
    >(
      `WITH RECURSIVE arbol AS (
         SELECT u.id AS id, 0 AS nivel
         FROM usuarios u
         WHERE u.id = ?
         UNION ALL
         SELECT h.id AS id, a.nivel + 1 AS nivel
         FROM arbol a
         INNER JOIN usuarios h ON h.parent_user_id = a.id
         WHERE a.nivel < ?
       )
       SELECT id, nivel FROM arbol ORDER BY nivel ASC, id ASC`,
      [usuarioId, NIVEL_MAXIMO],
    );

    // MySQL devuelve los enteros de la CTE como cadena, porque el tipo de la columna
    // recursiva lo deduce del literal inicial. Convertirlo aqui evita que quien use el
    // resultado tenga que compararlo con `"0"` y no con `0`.
    return filas.map((fila) => ({ id: fila.id, nivel: Number(fila.nivel) }));
  }

  /**
   * Comprueba que colgar un usuario de otro no crearia un ciclo.
   *
   * El caso facil es el evidente: un usuario no puede ser su propio superior. El que se
   * escapa es el indirecto, y es el que hay que mirar de verdad. Si A es superior de B, B
   * de C, y alguien propone que A cuelgue de C, la jerarquia queda circular y cualquier
   * recorrido del arbol entra en bucle.
   *
   * Se sube desde el padre propuesto y se devuelve `false` en cuanto aparece el usuario
   * que se queria colgar. La subida se consulta por niveles, no con una CTE, porque son
   * unas pocas filas y cada paso necesita una consulta: el numero de pasos es la
   * profundidad, y en una jerarquia real es pequeño.
   *
   * Ninguna restriccion de la base puede decir esto: una FK no detecta ciclos en una
   * autorreferencia, y un CHECK no puede consultar la propia tabla mientras se escribe.
   */
  async puedeColgarseDe(
    usuarioId: string,
    padreId: string | null,
  ): Promise<boolean> {
    // Sin padre no hay jerarquia que comprobar.
    if (padreId === null) return true;

    // Un usuario no puede depender de si mismo.
    if (padreId === usuarioId) return false;

    // El padre tiene que existir y estar vivo: colgar de un usuario dado de baja dejaria
    // un arbol con la raiz en alguien que ya no puede autenticarse ni ser realocado.
    const padre = await this.usuariosRepository.findOne({
      where: { id: padreId },
    });

    if (!padre || padre.deleted_at !== null) return false;

    const cadena = await this.rutaHastaRaiz(padreId);

    return !cadena.includes(usuarioId);
  }

  /**
   * Sube desde un usuario hasta la raiz y devuelve los ids por los que pasa, incluido el
   * usuario de partida.
   */
  private async rutaHastaRaiz(usuarioId: string): Promise<string[]> {
    const ids: string[] = [];
    let actual: string | null = usuarioId;

    for (let nivel = 0; nivel < NIVEL_MAXIMO && actual !== null; nivel += 1) {
      ids.push(actual);

      const fila: { parent_user_id: string | null } | undefined =
        await this.usuariosRepository
          .createQueryBuilder('u')
          .select('u.parent_user_id', 'parent_user_id')
          .where('u.id = :id', { id: actual })
          .getRawOne();

      if (!fila) break;

      actual = fila.parent_user_id;
    }

    return ids;
  }
}
