import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, IsNull, Repository } from 'typeorm';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { conflicto, noEncontrado } from '../common/errores.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import { patronBusqueda } from '../common/paginacion.js';
import { Permiso } from '../database/entities/permiso.entity.js';
import { Rol } from '../database/entities/rol.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';
import type {
  ActualizarRolDto,
  CrearRolDto,
  ListarRolesDto,
} from './rol.dto.js';

/** Forma que devuelve la API, sin las columnas internas de la tabla. */
export interface RolRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  activo: boolean;
  permisos: string[];
  created_at: Date;
  updated_at: Date;
}

/**
 * Referencia a una empresa para usarla en un `where`.
 *
 * `Rol.empresa_id` es `Empresa | null` porque las filas plantilla no tienen empresa, asi
 * que el cast directo a ese tipo arrastra el `null` y TypeORM lo rechaza. Aqui se
 * recorta con `NonNullable`: un rol que se busca o se escribe SIEMPRE tiene empresa,
 * porque sale del token.
 */
function soloEmpresa(id: string): NonNullable<Rol['empresa_id']> {
  return { id } as NonNullable<Rol['empresa_id']>;
}

/** Referencia al usuario que hace el cambio, para `created_by` / `updated_by`. */
function soloUsuario(id: string): NonNullable<Rol['created_by']> {
  return { id } as NonNullable<Rol['created_by']>;
}

/** Fila minima del catalogo de permisos. */
export interface PermisoRespuesta {
  id: string;
  codigo: string;
  modulo: string;
  descripcion: string | null;
}

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Rol)
    private readonly roles: Repository<Rol>,
    @InjectRepository(Permiso)
    private readonly permisos: Repository<Permiso>,
    @InjectRepository(UsuarioEmpresa)
    private readonly membresias: Repository<UsuarioEmpresa>,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Listado de roles de la empresa de la sesion.
   *
   * El filtro `empresa_id = :empresaId` no es una comprobacion opcional: es lo que
   * impide que el listado.include una fila. Y como la empresa sale del token, no hay
   * forma de pedir el catalogo de otro tenant.
   *
   * Los roles plantilla (`empresa_id IS NULL`) quedan fuera por construccion: la
   * igualdad con el id de la sesion ya los descarta, asi que no hace falta filtrarlos
   * aparte ni acordarse de hacerlo.
   */
  async listar(
    sesion: SesionActual,
    filtros: ListarRolesDto,
  ): Promise<RespuestaPaginada<RolRespuesta>> {
    const consulta = this.roles
      .createQueryBuilder('rol')
      .where('rol.empresa_id = :empresaId', { empresaId: sesion.empresa_id })
      // Siempre, tambien con `incluir_inactivos`. Ese flag existe para ver los roles
      // DESACTIVADOS, que son los que el filtro `activo` esconde; no para resucitar los
      // dados de baja, que no se pueden recuperar ni cambiar de codigo.
      .andWhere('rol.deleted_at IS NULL');

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('rol.activo = :activo', { activo: true });
    }

    if (filtros.buscar?.trim()) {
      consulta.andWhere(
        "(rol.codigo LIKE :patron ESCAPE '\\\\' OR rol.nombre LIKE :patron ESCAPE '\\\\')",
        { patron: patronBusqueda(filtros.buscar) },
      );
    }

    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('rol.nombre', 'ASC')
      .addOrderBy('rol.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: await this.aRespuestas(filas),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  async obtener(sesion: SesionActual, id: string): Promise<RolRespuesta> {
    return this.aRespuesta(await this.buscar(sesion, id));
  }

  /**
   * Alta de un rol dentro de la empresa de la sesion.
   *
   * `es_sistema` se pone siempre a false y no se acepta en el cuerpo. Los roles de
   * plantilla los crea `crearRolesPlantilla` al dar de alta la empresa, no el
   * administrador: si un endpoint pudiera marcar `es_sistema`, bastaria con enviarlo
   * para volver el rol intocable y bloquear su propio borrado.
   */
  async crear(
    sesion: SesionActual,
    dto: CrearRolDto,
    contexto?: ContextoPeticion,
  ): Promise<RolRespuesta> {
    await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo);

    const permisoIds = await this.resolverPermisos(dto.permisos ?? []);

    const nuevo: Partial<Rol> = {
      id: crypto.randomUUID(),
      empresa_id: soloEmpresa(sesion.empresa_id),
      codigo: dto.codigo,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      es_sistema: false,
      activo: dto.activo ?? true,
      created_by: soloUsuario(sesion.sub),
      updated_by: soloUsuario(sesion.sub),
    };

    // El rol y sus permisos van en la MISMA transaccion. Si el `save` fuera por su cuenta
    // y el alta de permisos fallara despues, quedaria un rol guardado sin los permisos
    // que la respuesta prometia, y el cliente veria un 500 sin ninguna forma de saber si
    // el alta se llevo a cabo. No es hipotetico: sin esto, un fallo al proyectar la
    // respuesta dejaba el rol creado en la base y el siguiente intento recibia un 409 de
    // codigo duplicado.
    await this.roles.manager.transaction(async (gestor) => {
      await gestor.save(Rol, nuevo);
      await this.escribirPermisos(
        gestor,
        nuevo.id as string,
        permisoIds,
        sesion.sub,
      );
    });

    const respuesta = await this.aRespuesta(
      await this.roles.findOneOrFail({ where: { id: nuevo.id } }),
    );

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'rol',
        entidad_id: respuesta.id,
        datos_despues: respuesta as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return respuesta;
  }

  /**
   * Modificacion parcial de un rol.
   *
   * El codigo no se toca (ver `ActualizarRolDto`) y hay dos bloqueos que no son
   * caprichos:
   *
   * - Un rol de sistema no se renombra. Las tres copias de la plantilla se llaman igual
   *   en toda la base; si una empresa las cambiara, el mismo nombre pasaria a designar
   *   cosas distintas segun donde se mire.
   * - Un rol con membresias activas no se desactiva. El permiso se relee en cada
   *   peticion, asi que `activo = false` expulsaria a esos usuarios en su siguiente
   *   llamada, sin aviso y sin que nadie haya tocado sus cuentas. Es mejor un 409 que
   *   diga que hay que reasignar primero.
   */
  async actualizar(
    sesion: SesionActual,
    id: string,
    dto: ActualizarRolDto,
    contexto?: ContextoPeticion,
  ): Promise<RolRespuesta> {
    const actual = await this.buscar(sesion, id);
    const antes = await this.aRespuesta(actual);

    if (
      dto.nombre !== undefined &&
      actual.es_sistema &&
      dto.nombre !== actual.nombre
    ) {
      throw conflicto(
        `El rol ${actual.codigo} viene de la plantilla y no se puede renombrar.`,
      );
    }

    if (dto.activo === false && actual.activo) {
      await this.comprobarSinMembresiasActivas(actual);
    }

    const cambios: Partial<Rol> = {
      updated_by: soloUsuario(sesion.sub),
    };
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.descripcion !== undefined) cambios.descripcion = dto.descripcion;
    if (dto.activo !== undefined) cambios.activo = dto.activo;

    const preparado = await this.roles.preload({ ...cambios, id: actual.id });
    if (!preparado) throw noEncontrado('el rol', id);

    await this.roles.save(preparado);

    const despues = await this.aRespuesta(
      await this.roles.findOneOrFail({ where: { id: actual.id } }),
    );

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'rol',
        entidad_id: id,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  /**
   * Sustituye el conjunto de permisos del rol.
   *
   * Es un `PUT` sobre un subrecurso, no un PATCH: lo que llega es lo que se aplica, sin
   * interpretar. Un cliente que quite un permiso debe poder quitarlo, y con semantica de
   * parche seria imposible.
   *
   * `rol_permiso` no tiene `deleted_at` a proposito: revocar un permiso es un DELETE
   * real. Ocultar la fila dejaria el permiso activo a ojos del guard, que lee la tabla.
   */
  async fijarPermisos(
    sesion: SesionActual,
    id: string,
    codigos: string[],
    contexto?: ContextoPeticion,
  ): Promise<RolRespuesta> {
    const actual = await this.buscar(sesion, id);
    const antes = await this.aRespuesta(actual);

    const ids = await this.resolverPermisos(codigos);

    // Un DELETE y un INSERT en vez de un diff. Con 29 permisos el coste es
    // irrelevante, y deja el conjunto exacto sin tener que leer el anterior y calcular
    // en memoria la diferencia para escribir despues: menos codigo y menos formas de
    // equivocarse.
    await this.reemplazarPermisos(actual.id, ids, sesion.sub);

    await this.roles.update(
      { id: actual.id },
      { updated_by: soloUsuario(sesion.sub) },
    );

    const despues = await this.aRespuesta(
      await this.roles.findOneOrFail({ where: { id: actual.id } }),
    );

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'rol',
        entidad_id: id,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  /**
   * Baja logica.
   *
   * Se bloquea si el rol tiene membresias activas, por lo mismo que la desactivacion:
   * dar de baja un rol en uso deja a esos usuarios sin permisos de golpe.
   */
  async eliminar(
    sesion: SesionActual,
    id: string,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    const actual = await this.buscar(sesion, id);

    if (actual.es_sistema) {
      throw conflicto(
        `El rol ${actual.codigo} viene de la plantilla y no se puede dar de baja.`,
      );
    }

    await this.comprobarSinMembresiasActivas(actual);

    await this.roles.update(
      { id: actual.id },
      {
        deleted_at: new Date(),
        activo: false,
        updated_by: soloUsuario(sesion.sub),
      },
    );

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'rol',
        entidad_id: id,
        datos_antes: (await this.aRespuesta(actual)) as unknown as Record<
          string,
          unknown
        >,
      },
      contexto,
    );
  }

  /**
   * Catalogo de permisos.
   *
   * Es global y se expone entero, y no es una fuga: lo define el codigo, no los
   * tenants, y es el mismo para todos. No hay datos de ninguna empresa aqui, y sin esto
   * el cliente no tendria forma de saber que codigos existen antes de concederlos.
   */
  async listarPermisos(): Promise<PermisoRespuesta[]> {
    const filas = await this.permisos.find({
      where: { deleted_at: IsNull() },
      order: { codigo: 'ASC' },
    });

    return filas.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      modulo: p.modulo,
      descripcion: p.descripcion,
    }));
  }

  /**
   * Busca un rol dentro de la empresa de la sesion.
   *
   * La plantilla (`empresa_id IS NULL`) no se encuentra nunca, y no por una comprobacion
   * extra: la condicion exige que coincida con el id de la sesion. No hay ruta para leer,
   * editar ni asignar un rol que no sea de la empresa de quien pregunta.
   */
  private async buscar(sesion: SesionActual, id: string): Promise<Rol> {
    const encontrado = await this.roles.findOne({
      where: {
        id,
        empresa_id: soloEmpresa(sesion.empresa_id),
      },
    });

    if (!encontrado) throw noEncontrado('el rol', id);

    return encontrado;
  }

  /**
   * Traduce codigos de permiso a ids, y falla si alguno no existe.
   *
   * Un codigo desconocido se rechaza nombrandolo en el 400 en vez de ignorarse. Si se
   * ignorara, un cliente con un typo creeria que ha concedido un permiso que en
   * realidad no existe, y se encontraria con un 403 mas tarde sin relacion aparente.
   */
  private async resolverPermisos(codigos: string[]): Promise<string[]> {
    // Se guardan las dos formas: la normalizada para consultar y para deduplicar, y la
    // original para el mensaje de error. Devolver `DEPARTAMENTO.INVENTAR` a un cliente
    // que escribio `departamento.inventar` obliga a que comparen en su cabeza, y en un
    // 400 la unica informacion util es exactamente cual de los valores que envio fallo.
    const originales = new Map<string, string>();
    for (const codigo of codigos) {
      originales.set(codigo.trim().toUpperCase(), codigo.trim());
    }

    const unicos = [...originales.keys()];
    if (unicos.length === 0) return [];

    const encontrados = await this.permisos.find({
      where: { codigo: In(unicos), deleted_at: IsNull() },
    });

    // Las claves se normalizan a mayusculas porque `unicos` lo esta, y MySQL si
    // encuentra la fila: su colacion no distingue de mayusculas, asi que el `WHERE`
    // localiza `puesto.leer` buscando `PUESTO.LEER`. El `Map` de JavaScript si
    // distingue, asi que sin normalizar aqui la busqueda fallaria siempre y todo
    // permiso escrito en minusculas se rechazaria como inexistente.
    const porCodigo = new Map(
      encontrados.map((p) => [p.codigo.toUpperCase(), p.id]),
    );
    const desconocidos = unicos
      .filter((c) => !porCodigo.has(c))
      .map((c) => originales.get(c) as string);

    if (desconocidos.length > 0) {
      throw new BadRequestException(
        `Permisos que no existen: ${desconocidos.join(', ')}. Consulta GET /api/v1/roles/permisos para ver el catalogo.`,
      );
    }

    // Se devuelven en el orden de `unicos` para que el INSERT sea determinista.
    return unicos.map((c) => porCodigo.get(c) as string);
  }

  /**
   * Escribe las filas de `rol_permiso` con el gestor de la transaccion en curso.
   *
   * No abre transaccion propia a proposito: quien la abre es quien decide el ambito, y
   * asi el alta del rol y la de sus permisos pueden deshacerse juntas.
   */
  private async escribirPermisos(
    gestor: EntityManager,
    rolId: string,
    permisoIds: string[],
    usuarioId: string,
  ): Promise<void> {
    for (const permisoId of permisoIds) {
      await gestor.insert('rol_permiso', {
        rol_id: rolId,
        permiso_id: permisoId,
        created_by: usuarioId,
      });
    }
  }

  /**
   * Deja el rol con exactamente ese conjunto de permisos.
   *
   * `rol_permiso` no tiene `deleted_at` a proposito: revocar un permiso es un DELETE
   * real. Ocultar la fila dejaria el permiso activo a ojos del guard, que lee la tabla.
   */
  private async reemplazarPermisos(
    rolId: string,
    permisoIds: string[],
    usuarioId: string,
  ): Promise<void> {
    await this.roles.manager.transaction(async (gestor) => {
      await gestor.delete('rol_permiso', { rol_id: rolId });
      await this.escribirPermisos(gestor, rolId, permisoIds, usuarioId);
    });
  }

  /**
   * El codigo esta libre dentro de la empresa.
   *
   * `LOWER()` porque la colacion de la tabla es insensible a mayusculas: `RRHH` y
   * `rrhh` chocarian en el indice unico, y conviene rechazarlo aqui con un mensaje
   * claro en lugar de que lo rechace MySQL.
   *
   * No sustituye al indice unico: dos altas simultaneas pueden pasar las dos por aqui.
   */
  private async comprobarCodigoLibre(
    empresaId: string,
    codigo: string,
  ): Promise<void> {
    const existente = await this.roles
      .createQueryBuilder('rol')
      .where('rol.empresa_id = :empresaId', { empresaId })
      .andWhere('LOWER(rol.codigo) = LOWER(:codigo)', { codigo })
      .andWhere('rol.deleted_at IS NULL')
      .getOne();

    if (existente) {
      throw conflicto(
        `Ya existe un rol con el codigo ${codigo} en esta empresa`,
      );
    }
  }

  /**
   * Falla si el rol tiene gente con membresia activa.
   *
   * Importa en las dos operaciones que cortan el acceso —desactivar y dar de baja—
   * porque el guard relee los permisos en cada peticion: el efecto es inmediato y no
   * pasa por ningun aviso.
   */
  private async comprobarSinMembresiasActivas(rol: Rol): Promise<void> {
    const activas = await this.membresias
      .createQueryBuilder('ue')
      .where('ue.rol_id = :rolId', { rolId: rol.id })
      .andWhere('ue.activo = true')
      .andWhere('ue.deleted_at IS NULL')
      .getCount();

    if (activas > 0) {
      throw conflicto(
        `El rol ${rol.codigo} tiene ${activas} usuario(s) con membresia activa. Reasignalos antes de desactivarlo o de darle de baja.`,
      );
    }
  }

  /** Proyecta un rol, con sus permisos ya resueltos. */
  private async aRespuesta(rol: Rol): Promise<RolRespuesta> {
    // Sin destructurar en `[datos]`: `EntityManager.query` de TypeORM devuelve las filas
    // directamente, no la tupla `[filas, campos]` que da `mysql2.Connection.query`. Con
    // `[datos]` se estaria haciendo `.map` sobre el primer objeto de la primera fila.
    const datos = (await this.roles.manager.query(
      'SELECT p.codigo FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE rp.rol_id = ? ORDER BY p.codigo',
      [rol.id],
    )) as { codigo: string }[];

    return {
      id: rol.id,
      codigo: rol.codigo,
      nombre: rol.nombre,
      descripcion: rol.descripcion,
      es_sistema: rol.es_sistema,
      activo: rol.activo,
      permisos: datos.map((f) => f.codigo),
      created_at: rol.created_at,
      updated_at: rol.updated_at,
    };
  }

  /** Proyecta varios roles resolviendo sus permisos en una sola consulta. */
  private async aRespuestas(roles: Rol[]): Promise<RolRespuesta[]> {
    if (roles.length === 0) return [];

    const ids = roles.map((r) => r.id);
    const filas = (await this.roles.manager.query(
      'SELECT rp.rol_id, p.codigo FROM rol_permiso rp JOIN permiso p ON p.id = rp.permiso_id WHERE rp.rol_id IN (?) ORDER BY p.codigo',
      [ids],
    )) as { rol_id: string; codigo: string }[];

    const porRol = new Map<string, string[]>();
    for (const fila of filas) {
      const lista = porRol.get(fila.rol_id) ?? [];
      lista.push(fila.codigo);
      porRol.set(fila.rol_id, lista);
    }

    return roles.map((rol) => ({
      id: rol.id,
      codigo: rol.codigo,
      nombre: rol.nombre,
      descripcion: rol.descripcion,
      es_sistema: rol.es_sistema,
      activo: rol.activo,
      permisos: porRol.get(rol.id) ?? [],
      created_at: rol.created_at,
      updated_at: rol.updated_at,
    }));
  }
}
