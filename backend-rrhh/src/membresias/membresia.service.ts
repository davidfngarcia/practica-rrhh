import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  type ContextoPeticion,
  AuditoriaService,
} from '../auditoria/auditoria.service.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { conflicto } from '../common/errores.js';
import {
  patronBusqueda,
  type RespuestaPaginada,
} from '../common/paginacion.js';
import { Rol } from '../database/entities/rol.entity.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';
import {
  ActualizarMembresiaDto,
  CambiarRolesDto,
  CrearMembresiaDto,
  ListarMembresiasDto,
} from './membresia.dto.js';

/**
 * Rol que puede administrar una empresa: el único con permisos `rol.*`.
 *
 * Se comprueba al quitar al último miembro con este rol porque quitarlo deja al tenant
 * sin nadie que pueda volver a conceder permisos. El único que podría arreglarlo es el
 * mismo que se acaba de quedar sin acceso, y no puede porque su membresía ya no existe.
 * No es recuperable desde la API.
 */
const CODIGO_ADMIN = 'ADMIN_EMPRESA';

/**
 * Referencia a una empresa para usarla en un `where`.
 *
 * Igual que en `RolesService`: `UsuarioEmpresa.empresa_id` no admite `null`, así que el
 * cast directo funciona, pero un helper con nombre dice mejor a qué empresa apunta que un
 * `{ id: ... } as never` suelto en mitad de un `where`.
 */
function soloEmpresa(id: string): UsuarioEmpresa['empresa_id'] {
  return { id } as UsuarioEmpresa['empresa_id'];
}

/** Referencia a un usuario, para `usuario_id`, `created_by` y `updated_by`. */
function soloUsuario(id: string): UsuarioEmpresa['usuario_id'] {
  return { id } as UsuarioEmpresa['usuario_id'];
}

/** Referencia a un rol, para `rol_id`. */
function soloRol(id: string): UsuarioEmpresa['rol_id'] {
  return { id } as UsuarioEmpresa['rol_id'];
}

/** Membresia tal y como sale por la API. */
export interface MembresiaRespuesta {
  id: string;
  usuario: {
    id: string;
    usuario: string;
    email: string | null;
    activo: boolean;
  };
  rol: { id: string; codigo: string; nombre: string };
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Fila de `usuario_empresa` con las relaciones ya cargadas. */
type MembresiaConRelaciones = UsuarioEmpresa & {
  usuario_id: Usuario;
  rol_id: Rol;
};

/**
 * Miembros de la empresa de la sesion.
 *
 * Aqui un usuario del sistema pasa a ser alguien de esta empresa: el usuario es global
 * (la misma persona puede estar en cinco empresas) y es la membresia la que concede el
 * rol, y con el los permisos.
 *
 * Dos reglas de integridad que la base no puede expresar y que se deciden aqui:
 *
 * - El rol tiene que ser de ESTA empresa. La FK solo dice que el rol existe, asi que una
 *   membresia podria apuntar al rol de otro tenant y sus permisos se estarian concediendo
 *   dentro de la empresa equivocada.
 * - El ultimo administrador activo no se puede quitar ni desactivar. Ver `CODIGO_ADMIN`.
 */
@Injectable()
export class MembresiasService {
  constructor(
    @InjectRepository(UsuarioEmpresa)
    private readonly membresias: Repository<UsuarioEmpresa>,
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Rol)
    private readonly roles: Repository<Rol>,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Miembros de la empresa de la sesion. */
  async listar(
    sesion: SesionActual,
    filtros: ListarMembresiasDto,
  ): Promise<RespuestaPaginada<MembresiaRespuesta>> {
    const consulta = this.membresias
      .createQueryBuilder('ue')
      .innerJoinAndSelect('ue.usuario_id', 'usuario')
      .innerJoinAndSelect('ue.rol_id', 'rol')
      .where('ue.empresa_id = :empresaId', { empresaId: sesion.empresa_id })
      .andWhere('ue.deleted_at IS NULL');

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('ue.activo = :activo', { activo: true });
    }

    if (filtros.buscar?.trim()) {
      // La busqueda se hace sobre los campos de la PERSONA, no de la membresia: nadie
      // busca a un compañero por el codigo de su rol, y el rol ya se filtra por su parte.
      const patron = patronBusqueda(filtros.buscar);
      consulta.andWhere(
        "(usuario.usuario LIKE :patron ESCAPE '\\\\' OR usuario.email LIKE :patron ESCAPE '\\\\')",
        { patron },
      );
    }

    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('usuario.usuario', 'ASC')
      .addOrderBy('ue.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: filas.map((m) => this.aRespuesta(m as MembresiaConRelaciones)),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  async obtener(sesion: SesionActual, id: string): Promise<MembresiaRespuesta> {
    return this.aRespuesta(await this.buscar(sesion, id));
  }

  /**
   * Da de alta a un miembro en la empresa con un rol.
   *
   * El usuario se busca de forma global, y a proposito: saber que una persona existe en el
   * sistema no es dato de otra empresa, y el flujo de invitacion es el que necesitara
   * encontrarla por correo o por nombre de usuario. Lo que NO se admite es traer un rol de
   * otra empresa.
   */
  async crear(
    sesion: SesionActual,
    dto: CrearMembresiaDto,
    contexto?: ContextoPeticion,
  ): Promise<MembresiaRespuesta> {
    if (dto.usuario_id === sesion.sub) {
      throw conflicto(
        'Ya eres miembro de esta empresa: no se puede crear una membresia duplicada para ti mismo.',
      );
    }

    const rol = await this.buscarRolDeEmpresa(sesion.empresa_id, dto.rol_id);

    const usuario = await this.usuarios.findOne({
      where: { id: dto.usuario_id, deleted_at: IsNull() },
    });
    if (!usuario) {
      throw new NotFoundException(
        `No existe el usuario con id ${dto.usuario_id}`,
      );
    }
    if (!usuario.activo) {
      throw new BadRequestException(
        `El usuario ${usuario.usuario} esta dado de baja: reactivalo antes de darle de alta en la empresa.`,
      );
    }

    // Solo bloquean las membresias VIGENTES. El unico esta sobre
    // `empresa_usuario_vigente`, que vale NULL en una fila dada de baja, asi que quien se
    // fue puede volver.
    const vigente = await this.membresias.findOne({
      where: {
        empresa_id: soloEmpresa(sesion.empresa_id),
        usuario_id: soloUsuario(dto.usuario_id),
        deleted_at: IsNull(),
      },
    });
    if (vigente) {
      throw conflicto(
        `El usuario ya es miembro de esta empresa. Si estaba dado de baja, reactivala en lugar de darle de alta otra vez.`,
      );
    }

    const nueva: Partial<UsuarioEmpresa> = {
      id: crypto.randomUUID(),
      empresa_id: soloEmpresa(sesion.empresa_id),
      usuario_id: soloUsuario(dto.usuario_id),
      rol_id: soloRol(rol.id),
      activo: dto.activo ?? true,
      created_by: soloUsuario(sesion.sub),
      updated_by: soloUsuario(sesion.sub),
    };

    await this.membresias.save(nueva);

    const respuesta = await this.aRespuesta(
      await this.buscar(sesion, nueva.id as string),
    );

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'usuario_empresa',
        entidad_id: respuesta.id,
        datos_despues: this.aAuditoria(respuesta),
      },
      contexto,
    );

    return respuesta;
  }

  /**
   * Modificacion parcial de una membresia.
   *
   * El cambio de rol va con `CAMBIO_ROL` y no con `ACTUALIZAR` porque es el dato que
   * responde a "quien gano acceso a que y cuando". Un `ACTUALIZAR` con un rol nuevo
   * dentro seria mas generico y menos util: habria que comparar fila a fila para saber que
   * paso.
   */
  async actualizar(
    sesion: SesionActual,
    id: string,
    dto: ActualizarMembresiaDto,
    contexto?: ContextoPeticion,
  ): Promise<MembresiaRespuesta> {
    const actual = await this.buscar(sesion, id);
    const antes = this.aRespuesta(actual);

    const seDesactiva = dto.activo === false && actual.activo;
    const cambiaRol =
      dto.rol_id !== undefined && dto.rol_id !== actual.rol_id.id;

    // El rol se resuelve antes de decidir nada, porque la comprobacion de administrador
    // necesita saber si se sale de `ADMIN_EMPRESA` y no solo que el rol cambia.
    const rol =
      dto.rol_id === undefined
        ? null
        : await this.buscarRolDeEmpresa(sesion.empresa_id, dto.rol_id);

    // Quitarse a uno mismo el rol propio es un cierre de sesion disfrazado, y el token
    // sigue siendo valido hasta que caduca: el guard relee los permisos de la base en
    // cada peticion, asi que la sesion se queda sin nada que hacer a mitad de trabajo.
    if (
      (seDesactiva || dto.rol_id !== undefined) &&
      this.esLaPropia(sesion, actual)
    ) {
      throw conflicto(
        'No puedes cambiar tu propio rol ni desactivar tu propia membresia: seria dejarte a ti mismo sin acceso.',
      );
    }

    // Salir de administrador cuenta igual que desaparecer, y esto es facil de colar: la
    // membresia sigue activa y visible en el listado, asi que el unico rastro de que la
    // empresa se ha quedado sin nadie con `rol.*` es este numero. Si alguien con
    // `usuario.actualizar` reasigna al ultimo administrador a un rol de consulta, y no
    // se avisa, la empresa no tiene a quien pedirle un permiso nuevo.
    if (seDesactiva || (cambiaRol && this.cedeElRolDeAdmin(actual, rol))) {
      await this.comprobarNoEsElUltimoAdmin(sesion.empresa_id, actual);
    }

    const cambios: Partial<UsuarioEmpresa> = {
      updated_by: soloUsuario(sesion.sub),
    };

    if (dto.activo !== undefined) cambios.activo = dto.activo;

    if (rol) {
      cambios.rol_id = soloRol(rol.id);
    }

    await this.membresias.update(actual.id, cambios);

    const despues = await this.aRespuesta(await this.buscar(sesion, actual.id));

    await this.auditoria.auditar(
      {
        accion: cambiaRol ? 'CAMBIO_ROL' : 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'usuario_empresa',
        entidad_id: despues.id,
        datos_antes: this.aAuditoria(antes),
        datos_despues: this.aAuditoria(despues),
      },
      contexto,
    );

    return despues;
  }

  /**
   * Reasigna el rol a varias membresias de una vez.
   *
   * Audita UN evento con la lista de afectados, y a proposito. Treinta `CAMBIO_ROL`
   * serian treinta filas que hay que cruzar para responder a una sola pregunta, y la
   * pregunta "por que nadie de contabilidad ve ya la nomina" se lleva las treinta.
   */
  async cambiarRoles(
    sesion: SesionActual,
    dto: CambiarRolesDto,
    contexto?: ContextoPeticion,
  ): Promise<MembresiaRespuesta[]> {
    const ids = [...new Set(dto.membresia_ids)];
    const rol = await this.buscarRolDeEmpresa(sesion.empresa_id, dto.rol_id);

    const actuales = await this.membresias.find({
      where: {
        id: In(ids),
        empresa_id: soloEmpresa(sesion.empresa_id),
        deleted_at: IsNull(),
      },
      relations: { usuario_id: true, rol_id: true },
    });

    if (actuales.length !== ids.length) {
      const encontrados = new Set(actuales.map((m) => m.id));
      const ajenas = ids.filter((i) => !encontrados.has(i));
      throw new NotFoundException(
        `No existen membresias de esta empresa con id: ${ajenas.join(', ')}`,
      );
    }

    const propias = actuales.filter((m) => this.esLaPropia(sesion, m));
    if (propias.length > 0) {
      throw conflicto(
        'No puedes cambiar tu propio rol: seria dejarte a ti mismo sin acceso.',
      );
    }

    // Aqui la comprobacion del ultimo administrador es OBLIGATORIA y no opcional, y no
    // solo por simetria con la edicion individual. Un cambio en bloque puede tocar a todos
    // los administradores de la empresa en una sola llamada, asi que el fallo no es
    // hipotetico: es la operacion que hace la empresa. Si se reasigna a un rol sin
    // `rol.*` a todos los administradores activos y el lote se aplica entero, la empresa se
    // queda sin nadie que pueda administrar sus roles, y desde ahi no hay vuelta atras por
    // la API porque el unico que podria devolver el permiso es el que ya no entra.
    for (const membresia of actuales) {
      if (this.cedeElRolDeAdmin(membresia, rol)) {
        await this.comprobarNoEsElUltimoAdmin(sesion.empresa_id, membresia);
      }
    }

    // El bloque en cascada NO lo puede hacer la base: MySQL no tiene disparadores, y
    // escribirlo en el servicio significa que cada via que llegue al `UPDATE` tiene que
    // acordarse. Por eso se comprueba antes y el `UPDATE` lleva el filtro de empresa, de
    // modo que si alguien anade otra via sin la comprobacion, el alcance sigue siendo el
    // correcto y lo que no podria hacer es dejar al tenant sin administrador.
    const afectadas = await this.membresias
      .createQueryBuilder()
      .update(UsuarioEmpresa)
      .set({ rol_id: soloRol(rol.id), updated_by: soloUsuario(sesion.sub) })
      .where('id IN (:...ids)', { ids })
      .andWhere('empresa_id = :empresaId', { empresaId: sesion.empresa_id })
      .andWhere('deleted_at IS NULL')
      .execute();

    const despues = await this.membresias.find({
      where: {
        id: In(ids),
        empresa_id: soloEmpresa(sesion.empresa_id),
        deleted_at: IsNull(),
      },
      relations: { usuario_id: true, rol_id: true },
    });

    const respuestas = despues
      .map((m) => this.aRespuesta(m as MembresiaConRelaciones))
      .sort((a, b) => a.usuario.usuario.localeCompare(b.usuario.usuario));

    await this.auditoria.auditar(
      {
        accion: 'CAMBIO_ROL',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'usuario_empresa',
        // `entidad_id` es la clave de UNA fila, pero el evento es de varias. Se apunta a
        // la primera de la lista: la auditoria se consulta por entidad para saltar
        // rapidamente a la fila, y el detalle de a quien affecto va entero en
        // `datos_despues`, que es donde se busca de verdad.
        entidad_id: respuestas[0]?.id ?? sesion.sub,
        datos_antes: {
          // El rol de cada persona ANTES del cambio. Sin esto, "de donde vino" se
          // responde adivinando, porque una misma persona puede haber pasado por varios
          // roles y `datos_despues` solo deja el ultimo.
          roles: actuales
            .map(
              (m) => `${(m.usuario_id as Usuario).usuario}: ${m.rol_id.codigo}`,
            )
            .join(', '),
        },
        datos_despues: {
          rol: rol.codigo,
          personas: respuestas.map((r) => r.usuario.usuario).join(', '),
          reasignadas: afectadas.affected ?? 0,
        },
      },
      contexto,
    );

    return respuestas;
  }

  /**
   * Da de baja a un miembro de la empresa. Es logico: la fila se conserva porque es parte
   * del historico, y porque la auditoria la apunta.
   */
  async eliminar(
    sesion: SesionActual,
    id: string,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    const actual = await this.buscar(sesion, id);

    if (this.esLaPropia(sesion, actual)) {
      throw conflicto('No puedes darte de baja a ti mismo de la empresa.');
    }

    await this.comprobarNoEsElUltimoAdmin(sesion.empresa_id, actual);

    await this.membresias.update(actual.id, {
      deleted_at: new Date(),
      updated_by: soloUsuario(sesion.sub),
    });

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'usuario_empresa',
        entidad_id: actual.id,
        datos_antes: this.aAuditoria(this.aRespuesta(actual)),
      },
      contexto,
    );
  }

  /** Una membresia de la empresa de la sesion, con sus relaciones cargadas. */
  private async buscar(
    sesion: SesionActual,
    id: string,
  ): Promise<MembresiaConRelaciones> {
    const membresia = await this.membresias.findOne({
      where: {
        id,
        empresa_id: soloEmpresa(sesion.empresa_id),
        deleted_at: IsNull(),
      },
      relations: { usuario_id: true, rol_id: true },
    });

    // 404 y no 403: con 403, un UUID de membresia se podria usar para enumerar a quien
    // pertenece a otra empresa. Aqui el mismo motivo que en la API de roles.
    if (!membresia) {
      throw new NotFoundException(
        `No existe la membresia con id ${id} en esta empresa`,
      );
    }

    return membresia as MembresiaConRelaciones;
  }

  /**
   * El rol tiene que ser de ESTA empresa y estar activo.
   *
   * El filtro por empresa es lo que impide conceder a alguien los permisos de otro
   * tenant: la FK solo garantiza que el rol existe, y un rol ajeno existe. Un rol de
   * plantilla tampoco vale, y no hace falta un filtro aparte: las plantillas tienen
   * `empresa_id IS NULL`, asi que la igualdad con el id de la sesion ya las descarta.
   *
   * Se responde 404, no 400, porque para quien pregunta el rol no existe: saber que hay
   * un `RRHH` en otra empresa es informacion de otro tenant.
   */
  private async buscarRolDeEmpresa(
    empresaId: string,
    rolId: string,
  ): Promise<Rol> {
    const rol = await this.roles.findOne({
      where: {
        id: rolId,
        empresa_id: soloEmpresa(empresaId),
        deleted_at: IsNull(),
      },
    });

    if (!rol) {
      throw new NotFoundException(
        `No existe el rol con id ${rolId} en esta empresa`,
      );
    }

    if (!rol.activo) {
      throw new BadRequestException(
        `El rol ${rol.codigo} esta desactivado: reactivalo antes de asignarlo.`,
      );
    }

    return rol;
  }

  /**
   * Dice si este cambio le quita a una membresia el rol de administrador.
   *
   * Se separa de `comprobarNoEsElUltimoAdmin` a proposito, porque son dos preguntas
   * distintas y confundirlas lleva a bugs en los dos sentidos:
   *
   * - Esta responde "el ADMIN sale?". Si el rol destino tambien es de administrador no hay
   *   nada que comprobar, porque el numero de administradores no baja.
   * - La otra responde "y si sale, es el ultimo?".
   *
   * Sin la primera, bloquearian cambios que no dejarian a nadie sin acceso; con la
   * segunda, dejarian pasar justo el que si lo deja.
   */
  private cedeElRolDeAdmin(
    membresia: MembresiaConRelaciones,
    rolDestino: Rol | null,
  ): boolean {
    if (!membresia.activo) return false;
    if (membresia.rol_id.codigo !== CODIGO_ADMIN) return false;
    return rolDestino !== null && rolDestino.codigo !== CODIGO_ADMIN;
  }

  /**
   * Falla si esta membresia es la ultima activa de un administrador de la empresa.
   *
   * Se cuenta ANTES de tocar nada, y se cuenta solo entre las activas. Si hubiera dos
   * administradores, quitar uno no deja al tenant huerfano y se deja pasar, que es lo que
   * hace falta para poder relevar a alguien sin pasar por un estado imposible de
   * recuperar.
   */
  private async comprobarNoEsElUltimoAdmin(
    empresaId: string,
    membresia: MembresiaConRelaciones,
  ): Promise<void> {
    if (!membresia.activo) return;
    if (membresia.rol_id.codigo !== CODIGO_ADMIN) return;

    // La empresa se recibe como parametro y no se lee de `membresia.empresa_id` porque
    // `buscar()` no carga esa relacion: leerla daria `undefined` y reventaria con un 500
    // en vez de con el 409 que toca. Ademas la empresa es un dato de la sesion, que es de
    // donde sale siempre y no se puede manipular desde el cuerpo.
    const otros = await this.membresias
      .createQueryBuilder('ue')
      .innerJoin('ue.rol_id', 'rol')
      .where('ue.empresa_id = :empresaId', { empresaId })
      .andWhere('rol.codigo = :codigo', { codigo: CODIGO_ADMIN })
      .andWhere('ue.activo = true')
      .andWhere('ue.deleted_at IS NULL')
      .andWhere('ue.id <> :id', { id: membresia.id })
      .getCount();

    if (otros === 0) {
      // El mensaje no dice "eres": en un cambio en bloque quien llama puede no ser el
      // administrador affectedo, y un "no puedes" dirigiendole a la persona equivocada
      // hace que el mensaje no cuadre con lo que ve.
      throw conflicto(
        'Esa es la unica membresia de administrador activa de esta empresa: no se puede quitar ni desactivar. Da de alta a otro administrador primero.',
      );
    }
  }

  /** Si la membresia es la del usuario de la sesion. */
  private esLaPropia(
    sesion: SesionActual,
    membresia: MembresiaConRelaciones,
  ): boolean {
    return membresia.usuario_id.id === sesion.sub;
  }

  /** Proyecta la membresia, aplanando las relaciones ya cargadas. */
  private aRespuesta(membresia: MembresiaConRelaciones): MembresiaRespuesta {
    return {
      id: membresia.id,
      usuario: {
        id: membresia.usuario_id.id,
        usuario: membresia.usuario_id.usuario,
        email: membresia.usuario_id.email,
        activo: membresia.usuario_id.activo,
      },
      rol: {
        id: membresia.rol_id.id,
        codigo: membresia.rol_id.codigo,
        nombre: membresia.rol_id.nombre,
      },
      activo: membresia.activo,
      created_at: membresia.created_at,
      updated_at: membresia.updated_at,
    };
  }

  /**
   * Forma que va a `auditoria`.
   *
   * Se aplana a proposito: `datos_antes` guarda el JSON de la respuesta, y dentro hay un
   * correo y un nombre de usuario que no son secretos pero tampoco son lo que se quiere
   * leer dentro de dos anos. Con el nombre de usuario se identifica a la persona, y con
   * el codigo del rol se responde a la pregunta que se hace al leer la auditoria.
   */
  private aAuditoria(membresia: MembresiaRespuesta): Record<string, unknown> {
    return {
      usuario: membresia.usuario.usuario,
      rol: membresia.rol.codigo,
      activo: membresia.activo,
    };
  }
}
