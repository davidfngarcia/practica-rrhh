import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { conflicto, noEncontrado } from '../common/errores.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import { patronBusqueda } from '../common/paginacion.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { Departamento } from '../database/entities/departamento.entity.js';
import type {
  ActualizarDepartamentoDto,
  CrearDepartamentoDto,
  ListarDepartamentosDto,
} from './departamento.dto.js';

/** Forma que devuelve la API, sin las columnas internas de la tabla. */
export interface DepartamentoRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class DepartamentosService {
  constructor(
    @InjectRepository(Departamento)
    private readonly departamentos: Repository<Departamento>,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Listado de la empresa de la sesion.
   *
   * Todas las consultas filtran por `empresa_id`. No es una comprobacion opcional:
   * es lo que impide que el rol RRHH de una empresa vea los departamentos de otra.
   */
  async listar(
    sesion: SesionActual,
    filtros: ListarDepartamentosDto,
  ): Promise<RespuestaPaginada<DepartamentoRespuesta>> {
    const consulta = this.departamentos
      .createQueryBuilder('departamento')
      .where('departamento.empresa_id = :empresaId', {
        empresaId: sesion.empresa_id,
      });

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('departamento.activo = :activo', { activo: true });
    }

    if (filtros.buscar?.trim()) {
      consulta.andWhere(
        "(departamento.codigo LIKE :patron ESCAPE '\\\\' OR departamento.nombre LIKE :patron ESCAPE '\\\\')",
        { patron: patronBusqueda(filtros.buscar) },
      );
    }

    // El `id` desempata: sin un orden totalmente definido, dos peticiones iguales
    // podrian devolver los mismos elementos en paginas distintas.
    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('departamento.nombre', 'ASC')
      .addOrderBy('departamento.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: filas.map((d) => this.aRespuesta(d)),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  /** Un departamento concreto, o 404 si no existe en esta empresa. */
  async obtener(
    sesion: SesionActual,
    id: string,
  ): Promise<DepartamentoRespuesta> {
    return this.aRespuesta(await this.buscar(sesion, id));
  }

  async crear(
    sesion: SesionActual,
    dto: CrearDepartamentoDto,
    contexto?: ContextoPeticion,
  ): Promise<DepartamentoRespuesta> {
    await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo);

    const nuevo: Partial<Departamento> = {
      id: crypto.randomUUID(),
      // Las relaciones van como referencia con la PK: `{ id }` y no el UUID suelto.
      empresa_id: { id: sesion.empresa_id } as Departamento['empresa_id'],
      codigo: dto.codigo,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      activo: dto.activo ?? true,
      created_by: { id: sesion.sub } as Departamento['created_by'],
      updated_by: { id: sesion.sub } as Departamento['updated_by'],
    };

    const guardado = await this.departamentos.save(nuevo);

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'departamento',
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
    dto: ActualizarDepartamentoDto,
    contexto?: ContextoPeticion,
  ): Promise<DepartamentoRespuesta> {
    const actual = await this.buscar(sesion, id);
    const antes = this.aRespuesta(actual);

    if (dto.codigo !== undefined && dto.codigo !== actual.codigo) {
      await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo, id);
    }

    // Solo se tocan los campos que llegan: un PATCH con `{ activo: false }` no
    // debe vaciar la descripcion.
    const cambios: Partial<Departamento> = {
      updated_by: { id: sesion.sub } as Departamento['updated_by'],
    };

    if (dto.codigo !== undefined) cambios.codigo = dto.codigo;
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.descripcion !== undefined) cambios.descripcion = dto.descripcion;
    if (dto.activo !== undefined) cambios.activo = dto.activo;

    // `save()` con un objeto parcial devuelve solo los campos enviados: el PATCH
    // respondería sin `codigo`, `activo` ni las fechas, y la auditoría guardaría un
    // estado posterior incompleto. `preload()` parte de la fila completa, le aplica
    // encima lo que trae el DTO y devuelve la entidad entera.
    const preparado = await this.departamentos.preload({
      ...cambios,
      id: actual.id,
    });

    // `preload()` solo devuelve `undefined` si la fila ya no existe, y `buscar` la
    // acaba de encontrar. El guardia está para que TypeScript lo contemple y por
    // si acaso.
    if (!preparado) throw noEncontrado('el departamento', id);

    const guardado = await this.departamentos.save(preparado);
    const despues = this.aRespuesta(guardado);

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'departamento',
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
   * No se borra la fila porque los empleados del departamento la referencian. El
   * indice unico `uq_departamento_codigo` usa la columna generada `codigo_vigente`,
   * que vale NULL en las filas borradas: asi el codigo queda libre para reutilizar
   * sin chocar con el historico.
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
    await this.departamentos.update(
      {
        id: actual.id,
        empresa_id: { id: sesion.empresa_id } as Departamento['empresa_id'],
      },
      {
        deleted_at: new Date(),
        activo: false,
        updated_by: { id: sesion.sub } as Departamento['updated_by'],
      },
    );

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'departamento',
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
   * Busca un departamento dentro de la empresa de la sesion.
   *
   * El filtro por empresa no es opcional: es la barrera que impide leer datos de
   * otra empresa suponiendo un UUID.
   */
  private async buscar(
    sesion: SesionActual,
    id: string,
  ): Promise<Departamento> {
    const encontrado = await this.departamentos.findOne({
      where: {
        id,
        empresa_id: { id: sesion.empresa_id } as Departamento['empresa_id'],
      },
    });

    if (!encontrado) throw noEncontrado('el departamento', id);

    return encontrado;
  }

  /**
   * Comprueba que el codigo este libre dentro de la empresa.
   *
   * Se compara sin distincion de mayusculas porque la columna esta con una
   * colacion insensible a ellas: `RRHH` y `rrhh` chocarian en el indice unico, asi que
   * conviene rechazarlo aqui con un mensaje claro en lugar de dejar que lo rechace
   * MySQL con un error de duplicado.
   *
   * La comprobacion no sustituye al indice unico: dos altas simultaneas pueden pasar
   * las dos por aqui, y en ese caso es la base de datos la que resuelve el choque.
   */
  private async comprobarCodigoLibre(
    empresaId: string,
    codigo: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.departamentos
      .createQueryBuilder('departamento')
      .where('departamento.empresa_id = :empresaId', { empresaId })
      .andWhere('LOWER(departamento.codigo) = LOWER(:codigo)', { codigo })
      .getOne();

    if (existente && existente.id !== exceptoId) {
      throw conflicto(
        `Ya existe un departamento con el codigo ${codigo} en esta empresa`,
      );
    }
  }

  /** Proyecta la entidad a la forma que consume el frontend. */
  private aRespuesta(departamento: Departamento): DepartamentoRespuesta {
    return {
      id: departamento.id,
      codigo: departamento.codigo,
      nombre: departamento.nombre,
      descripcion: departamento.descripcion,
      activo: departamento.activo,
      created_at: departamento.created_at,
      updated_at: departamento.updated_at,
    };
  }
}
