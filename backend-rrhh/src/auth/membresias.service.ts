import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Empresa } from '../database/entities/empresa.entity.js';
import { Rol } from '../database/entities/rol.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';

/** Empresa a la que pertenece el usuario, con su rol. */
export interface Membresia {
  empresa_id: string;
  empresa_nombre: string;
  rol_codigo: string;
  rol_nombre: string;
}

@Injectable()
export class MembresiasService {
  constructor(
    @InjectRepository(UsuarioEmpresa)
    private readonly membresias: Repository<UsuarioEmpresa>,
    @InjectRepository(Rol)
    private readonly roles: Repository<Rol>,
    @InjectRepository(Empresa)
    private readonly empresas: Repository<Empresa>,
  ) {}

  /**
   * Empresas activas en las que el usuario es miembro, con su rol.
   *
   * Filtra por `activo` en la membresia, en el rol y en la empresa: un rol dado de
   * baja no debe seguir concediendo permisos, y una empresa inactiva no debe
   * admitir sesion.
   */
  async listarActivas(usuarioId: string): Promise<Membresia[]> {
    return this.membresias
      .createQueryBuilder('ue')
      .innerJoin('ue.empresa_id', 'e')
      .innerJoin('ue.rol_id', 'r')
      .where('ue.usuario_id = :usuarioId', { usuarioId })
      .andWhere('ue.activo = true')
      .andWhere('ue.deleted_at IS NULL')
      .andWhere('e.activo = true')
      .andWhere('e.deleted_at IS NULL')
      .andWhere('r.activo = true')
      .andWhere('r.deleted_at IS NULL')
      .select([
        'ue.empresa_id AS empresa_id',
        'e.nombre AS empresa_nombre',
        'r.codigo AS rol_codigo',
        'r.nombre AS rol_nombre',
      ])
      .orderBy('e.nombre', 'ASC')
      .getRawMany<Membresia>();
  }

  /**
   * Verifica que el usuario es miembro activo de esa empresa. Devuelve el rol o
   * `null`; el 403 se decide en la capa de auth para no filtrar informacion aqui.
   */
  async buscarRolActivo(
    usuarioId: string,
    empresaId: string,
  ): Promise<{ rol_id: string; rol_codigo: string } | null> {
    const fila = await this.membresias
      .createQueryBuilder('ue')
      .innerJoin('ue.rol_id', 'r')
      .where('ue.usuario_id = :usuarioId', { usuarioId })
      .andWhere('ue.empresa_id = :empresaId', { empresaId })
      .andWhere('ue.activo = true')
      .andWhere('ue.deleted_at IS NULL')
      .andWhere('r.activo = true')
      .andWhere('r.deleted_at IS NULL')
      .select(['ue.rol_id AS rol_id', 'r.codigo AS rol_codigo'])
      .getRawOne<{ rol_id: string; rol_codigo: string }>();

    return fila ?? null;
  }

  async exigirMembresia(
    usuarioId: string,
    empresaId: string,
  ): Promise<{ rol_id: string; rol_codigo: string }> {
    const rol = await this.buscarRolActivo(usuarioId, empresaId);
    if (!rol) {
      throw new ForbiddenException('No tienes acceso a la empresa indicada.');
    }
    return rol;
  }

  /** Nombre legible del rol, para incluirlo en la respuesta del login. */
  async detalleRol(rolId: string): Promise<{ nombre: string }> {
    const rol = await this.roles.findOne({ where: { id: rolId } });
    if (!rol) {
      throw new ForbiddenException(
        'El rol asignado no existe o esta inactivo.',
      );
    }
    return { nombre: rol.nombre };
  }

  /** Nombre de la empresa, para el claim `empresa_nombre`. */
  async nombreEmpresa(empresaId: string): Promise<string> {
    const empresa = await this.empresas.findOne({ where: { id: empresaId } });
    if (!empresa) {
      throw new ForbiddenException('La empresa ya no esta disponible.');
    }
    return empresa.nombre;
  }
}
