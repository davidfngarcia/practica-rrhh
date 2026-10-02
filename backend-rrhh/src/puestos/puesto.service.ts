import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { conflicto, noEncontrado } from '../common/errores.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import { patronBusqueda } from '../common/paginacion.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { Puesto } from '../database/entities/puesto.entity.js';
import type {
  ActualizarPuestoDto,
  CrearPuestoDto,
  ListarPuestosDto,
} from './puesto.dto.js';

/** Forma que devuelve la API, sin las columnas internas de la tabla. */
export interface PuestoRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PuestosService {
  constructor(
    @InjectRepository(Puesto)
    private readonly puestos: Repository<Puesto>,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Listado de la empresa de la sesion.
   *
   * Todas las consultas filtran por `empresa_id`. No es una comprobacion opcional:
   * es lo que impide que el rol RRHH de una empresa vea los puestos de otra.
   */
  async listar(
    sesion: SesionActual,
    filtros: ListarPuestosDto,
  ): Promise<RespuestaPaginada<PuestoRespuesta>> {
    const consulta = this.puestos
      .createQueryBuilder('puesto')
      .where('puesto.empresa_id = :empresaId', {
        empresaId: sesion.empresa_id,
      });

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('puesto.activo = :activo', { activo: true });
    }

    if (filtros.buscar?.trim()) {
      consulta.andWhere(
        "(puesto.codigo LIKE :patron ESCAPE '\\\\' OR puesto.nombre LIKE :patron ESCAPE '\\\\')",
        { patron: patronBusqueda(filtros.buscar) },
      );
    }

    // El `id` desempata: sin un orden totalmente definido, dos peticiones iguales
    // podrian devolver los mismos elementos en paginas distintas.
    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('puesto.nombre', 'ASC')
      .addOrderBy('puesto.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: filas.map((p) => this.aRespuesta(p)),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  /** Un puesto concreto, o 404 si no existe en esta empresa. */
  async obtener(sesion: SesionActual, id: string): Promise<PuestoRespuesta> {
    return this.aRespuesta(await this.buscar(sesion, id));
  }

  async crear(
    sesion: SesionActual,
    dto: CrearPuestoDto,
    contexto?: ContextoPeticion,
  ): Promise<PuestoRespuesta> {
    await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo);

    const nuevo: Partial<Puesto> = {
      id: crypto.randomUUID(),
      // Las relaciones van como referencia con la PK: `{ id }` y no el UUID suelto.
      empresa_id: { id: sesion.empresa_id } as Puesto['empresa_id'],
      codigo: dto.codigo,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      activo: dto.activo ?? true,
      created_by: { id: sesion.sub } as Puesto['created_by'],
      updated_by: { id: sesion.sub } as Puesto['updated_by'],
    };

    const guardado = await this.puestos.save(nuevo);

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'puesto',
        entidad_id: guardado.id,
        datos_despues: this.aRespuesta(guardado) as unknown as Record<
          string,
          unknown
        >,
      },
      contexto,
    );

    return this.aRespuesta(guardado);
  }

  async actualizar(
    sesion: SesionActual,
    id: string,
    dto: ActualizarPuestoDto,
    contexto?: ContextoPeticion,
  ): Promise<PuestoRespuesta> {
    const actual = await this.buscar(sesion, id);
    const antes = this.aRespuesta(actual);

    if (dto.codigo !== undefined && dto.codigo !== actual.codigo) {
      await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo, id);
    }

    // Solo se tocan los campos que llegan: un PATCH con `{ activo: false }` no
    // debe vaciar la descripcion.
    const cambios: Partial<Puesto> = {
      updated_by: { id: sesion.sub } as Puesto['updated_by'],
    };

    if (dto.codigo !== undefined) cambios.codigo = dto.codigo;
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.descripcion !== undefined) cambios.descripcion = dto.descripcion;
    if (dto.activo !== undefined) cambios.activo = dto.activo;

    // `save()` con un objeto parcial devuelve solo los campos enviados: el PATCH
    // respondería sin `codigo`, `activo` ni las fechas, y la auditoría guardaría un
    // estado posterior incompleto. `preload()` parte de la fila completa, le aplica
    // encima lo que trae el DTO y devuelve la entidad entera.
    const preparado = await this.puestos.preload({
      ...cambios,
      id: actual.id,
    });

    // `preload()` solo devuelve `undefined` si la fila ya no existe, y `buscar` la
    // acaba de encontrar. El guardia está para que TypeScript lo contemple y por
    // si acaso.
    if (!preparado) throw noEncontrado('el puesto', id);

    const guardado = await this.puestos.save(preparado);
    const despues = this.aRespuesta(guardado);

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'puesto',
        entidad_id: id,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  /**
   * Baja logica: marca `deleted_at` y desactiva el registro.
   *
   * No se borra la fila porque los empleados del puesto la referencian. El indice
   * unico `uq_puesto_codigo` usa la columna generada `codigo_vigente`, que vale NULL
   * en las filas borradas: asi el codigo queda libre para reutilizar sin chocar con
   * el historico.
   */
  async eliminar(
    sesion: SesionActual,
    id: string,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    const actual = await this.buscar(sesion, id);

    // `repository.softDelete()` solo admite el criterio y no permite escribir
    // `activo` ni `updated_by` en la misma sentencia, que es justo lo que hace
    // falta aqui. Se marca `deleted_at` a mano: MySQL recalcula sola la columna
    // generada `codigo_vigente`, que pasa a NULL y libera el codigo.
    await this.puestos.update(
      {
        id: actual.id,
        empresa_id: { id: sesion.empresa_id } as Puesto['empresa_id'],
      },
      {
        deleted_at: new Date(),
        activo: false,
        updated_by: { id: sesion.sub } as Puesto['updated_by'],
      },
    );

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'puesto',
        entidad_id: id,
        datos_antes: this.aRespuesta(actual) as unknown as Record<
          string,
          unknown
        >,
      },
      contexto,
    );
  }

  /**
   * Busca un puesto dentro de la empresa de la sesion.
   *
   * El filtro por empresa no es opcional: es la barrera que impide leer datos de
   * otra empresa suponiendo un UUID.
   */
  private async buscar(sesion: SesionActual, id: string): Promise<Puesto> {
    const encontrado = await this.puestos.findOne({
      where: {
        id,
        empresa_id: { id: sesion.empresa_id } as Puesto['empresa_id'],
      },
    });

    if (!encontrado) throw noEncontrado('el puesto', id);

    return encontrado;
  }

  /**
   * Comprueba que el codigo este libre dentro de la empresa.
   *
   * Se compara sin distincion de mayusculas porque la columna esta con una
   * colacion insensible a ellas: `RRHH` y `rrhh` chocarian en el indice unico, asi
   * que conviene rechazarlo aqui con un mensaje claro en lugar de dejar que lo
   * rechace MySQL con un error de duplicado.
   *
   * La comprobacion no sustituye al indice unico: dos altas simultaneas pueden pasar
   * las dos por aqui, y en ese caso es la base de datos la que resuelve el choque.
   */
  private async comprobarCodigoLibre(
    empresaId: string,
    codigo: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.puestos
      .createQueryBuilder('puesto')
      .where('puesto.empresa_id = :empresaId', { empresaId })
      .andWhere('LOWER(puesto.codigo) = LOWER(:codigo)', { codigo })
      .getOne();

    if (existente && existente.id !== exceptoId) {
      throw conflicto(
        `Ya existe un puesto con el codigo ${codigo} en esta empresa`,
      );
    }
  }

  /** Proyecta la entidad a la forma que consume el frontend. */
  private aRespuesta(puesto: Puesto): PuestoRespuesta {
    return {
      id: puesto.id,
      codigo: puesto.codigo,
      nombre: puesto.nombre,
      descripcion: puesto.descripcion,
      activo: puesto.activo,
      created_at: puesto.created_at,
      updated_at: puesto.updated_at,
    };
  }
}
