import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RefreshToken } from '../database/entities/refresh-token.entity.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { UsersService } from '../users/users.service.js';
import { MembresiasService } from './membresias.service.js';
import { Claims } from './sesion.decorator.js';
import { configApp } from '../config/config.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly membresiasService: MembresiasService,
    private readonly jwtService: JwtService,
    @InjectRepository(Usuario)
    private readonly usuarios: Repository<Usuario>,
  ) {}

  /**
   * Verifica credenciales.
   *
   * El mensaje de error es identico exista o no el usuario. Distinguir ambos casos
   * permitiria enumerar cuentas validas.
   */
  async validarCredenciales(
    usuario: string,
    password: string,
  ): Promise<Usuario> {
    const user = await this.usersService.findActivo(usuario);

    // Si no hay usuario, se compara igualmente contra un hash ficticio para que el
    // tiempo de respuesta no dependa de si la cuenta existe.
    const hash = user?.password_hash ?? this.hashInexistente();
    const coincide = await bcrypt.compare(password, hash);

    if (!user || !coincide) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return user;
  }

  /**
   * Hash de un usuario que no existe. Se genera una vez por proceso: recalcularlo
   * en cada intento fallido gastaria CPU de bcrypt en el camino que mas nos
   * interesa que sea barato para un atacante.
   */
  private hashInexistente(): string {
    this.hashFicticio ??= bcrypt.hashSync('este-usuario-no-existe', 10);
    return this.hashFicticio;
  }

  private hashFicticio: string | null = null;

  /** Actualiza `ultimo_acceso` tras un login correcto. */
  async registrarAcceso(usuarioId: string): Promise<void> {
    await this.usuarios.update(usuarioId, { ultimo_acceso: new Date() });
  }

  /** Empresas activas del usuario. */
  async listarEmpresas(usuarioId: string) {
    return this.membresiasService.listarActivas(usuarioId);
  }

  async buscarPorId(usuarioId: string): Promise<Usuario> {
    const user = await this.usuarios.findOne({
      where: { id: usuarioId, activo: true },
    });
    if (!user) {
      throw new UnauthorizedException('Usuario inactivo o inexistente');
    }
    return user;
  }

  /**
   * Rol del usuario en esa empresa, con su nombre. Se relee al emitir token y no
   * desde el token anterior, para que un cambio de rol surta efecto de inmediato.
   */
  async rolDe(
    usuarioId: string,
    empresaId: string,
  ): Promise<{ id: string; codigo: string; nombre: string }> {
    const rol = await this.membresiasService.buscarRolActivo(
      usuarioId,
      empresaId,
    );
    if (!rol) {
      throw new UnauthorizedException('No tienes acceso a la empresa indicada');
    }

    const detalle = await this.membresiasService.detalleRol(rol.rol_id);
    return { id: rol.rol_id, codigo: rol.rol_codigo, nombre: detalle.nombre };
  }

  /**
   * Claims a partir de un refresh token ya rotado. El usuario y la empresa se
   * revalidan: un refresh vigente no debe mantener viva la sesion de una cuenta
   * desactivada o de una empresa cerrada.
   */
  async claimsDeSesion(registro: RefreshToken): Promise<Claims> {
    // Sin `relations`, TypeORM devuelve la entidad plana: `usuario_id` y
    // `empresa_id` son UUID, no objetos. Se leen como columnas crudas.
    const [destinatario] = await this.usuarios.manager.query(
      'SELECT `usuario_id`, `empresa_id` FROM `refresh_token` WHERE `id` = ? LIMIT 1',
      [registro.id],
    );

    const usuarioId = destinatario?.usuario_id as string | undefined;
    const empresaId = (destinatario?.empresa_id ?? null) as string | null;

    if (!usuarioId) {
      throw new UnauthorizedException(
        'El refresh token no tiene usuario asociado',
      );
    }

    if (!empresaId) {
      throw new UnauthorizedException(
        'El refresh token no tiene empresa asociada',
      );
    }

    const user = await this.buscarPorId(usuarioId);

    const rol = await this.rolDe(user.id, empresaId);
    const empresa = await this.membresiasService.nombreEmpresa(empresaId);

    return {
      sub: user.id,
      usuario: user.usuario,
      empresa_id: empresaId,
      empresa_nombre: empresa,
      rol_id: rol.id,
      rol_codigo: rol.codigo,
    };
  }

  /** Firma el access token. */
  async firmarAcceso(claims: Claims): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
  }> {
    const acceso = await this.jwtService.signAsync(claims);

    return {
      access_token: acceso,
      token_type: 'Bearer',
      // Se declara en segundos, que es lo que espera un cliente OAuth.
      expires_in: this.segundosDeCaducidad(),
    };
  }

  /** Traduce `JWT_ACCESS_EXPIRES_IN` a segundos para el campo `expires_in`. */
  private segundosDeCaducidad(): number {
    const texto = configApp().jwtAccessExpiresIn;
    const coincidencia = /^(\d+)\s*(s|m|h|d)?$/i.exec(texto);

    if (!coincidencia) {
      throw new BadRequestException(
        `JWT_ACCESS_EXPIRES_IN con formato no soportado: "${texto}". Usa 900, 15m o 1h.`,
      );
    }

    const unidades = { s: 1, m: 60, h: 3600, d: 86400 } as const;
    const factor =
      unidades[(coincidencia[2] ?? 's').toLowerCase() as keyof typeof unidades];

    return Number(coincidencia[1]) * factor;
  }
}
