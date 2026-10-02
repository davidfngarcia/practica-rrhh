import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Permiso } from '../database/entities/permiso.entity.js';
import { RolPermiso } from '../database/entities/rol-permiso.entity.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { configApp } from '../config/config.js';
import { Claims, SesionActual } from './sesion.decorator.js';

/**
 * Valida el access token y reconstruye la sesion con los permisos actuales del
 * rol.
 *
 * Los permisos se leen de la base en cada request, no se cargan en el token. El
 * token vive 15 minutos: si un permiso se revoca, un token emitido antes seguira
 * dando acceso hasta expirar. Aceptar eso daria una ventana de acceso indebido
 * justo en el escenario que la revocacion pretende cerrar.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
    @InjectRepository(RolPermiso)
    private readonly rolPermisos: Repository<RolPermiso>,
    @InjectRepository(Permiso)
    private readonly permisos: Repository<Permiso>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configApp().jwtSecret,
    });
  }

  async validate(claims: Claims): Promise<SesionActual> {
    // El usuario debe seguir activo. Se relee en cada request porque el token vive
    // 15 minutos: sin esta comprobacion, desactivar una cuenta no expulsaria las
    // sesiones ya abiertas.
    const usuario = await this.usuarios.findOne({
      where: { id: claims.sub, activo: true },
    });
    if (!usuario) {
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }

    // Empresa activa y membresia vigente para ESE rol. Si el usuario pierde la
    // membresia o le cambian el rol, el token anterior deja de servir de inmediato.
    const sesion = await this.usuarios.manager.query(
      `SELECT e.\`activo\` AS empresa_activa,
              ue.\`activo\` AS membresia_activa,
              ue.\`rol_id\` AS rol_actual,
              ue.\`deleted_at\` AS borrada,
              r.\`activo\` AS rol_activo
         FROM \`usuario_empresa\` ue
         JOIN \`empresa\` e ON e.\`id\` = ue.\`empresa_id\`
         JOIN \`rol\` r ON r.\`id\` = ue.\`rol_id\`
        WHERE ue.\`usuario_id\` = ? AND ue.\`empresa_id\` = ?
        LIMIT 1`,
      [claims.sub, claims.empresa_id],
    );

    const fila = sesion[0];

    if (!fila || fila.empresa_activa !== 1) {
      throw new UnauthorizedException('La empresa ya no esta disponible');
    }

    if (
      fila.borrada !== null ||
      fila.membresia_activa !== 1 ||
      fila.rol_activo !== 1
    ) {
      throw new UnauthorizedException('Ya no tienes acceso a esta empresa');
    }

    if (fila.rol_actual !== claims.rol_id) {
      throw new UnauthorizedException('Tu rol en esta empresa ha cambiado');
    }

    return { ...claims, permissions: await this.cargarPermisos(claims.rol_id) };
  }

  /**
   * Codigos de permiso asignados al rol.
   *
   * `RolPermiso` expone la FK como columna plana (`permiso_id`), asi que la
   * relacion a unir es `rp.permiso`, no `rp.permiso_id`.
   */
  private async cargarPermisos(rolId: string): Promise<string[]> {
    const filas = await this.rolPermisos
      .createQueryBuilder('rp')
      .innerJoin('rp.permiso', 'p')
      .where('rp.rol_id = :rolId', { rolId })
      // `rol_permiso` no tiene `deleted_at`: al quitar un permiso se borra la fila.
      .andWhere('p.activo = true')
      .andWhere('p.deleted_at IS NULL')
      .select('p.codigo', 'codigo')
      .getRawMany<{ codigo: string }>();

    return filas.map((f) => f.codigo);
  }
}
