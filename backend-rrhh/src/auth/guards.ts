import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SesionActual } from './sesion.decorator.js';

/**
 * Rutas publicas.
 *
 * Sin `@Public()` un endpoint exige token. Es mas seguro que lo contrario: anadir
 * un endpoint nuevo no lo deja exposed por olvido.
 */
export const IS_PUBLIC_KEY = 'auth:public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige `modulo.accion` sobre la empresa de la sesion. */
export const PERMISOS_KEY = 'auth:permisos';
export const RequirePermissions = (...permisos: string[]) =>
  SetMetadata(PERMISOS_KEY, permisos);

/** JwtAuthGuard que respeta `@Public()`. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const esPublica = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (esPublica) return true;
    return super.canActivate(context);
  }

  /**
   * `AuthGuard` lanza `UnauthorizedException` sin texto cuando falta el token o
   * cuando no valida, y el mensaje por defecto es el ingles "Unauthorized", que
   * no deja distinguir un caso del otro. Aqui se separan: el frontend necesita
   * saber si debe pedir un token nuevo o llevar al usuario al login.
   */
  handleRequest<TUser>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const request = context.switchToHttp().getRequest<Request>();
      const hayToken = typeof request.headers.authorization === 'string';

      throw new UnauthorizedException(
        hayToken
          ? 'El token de acceso no es valido o ha caducado'
          : 'Falta el token de acceso',
      );
    }

    return user;
  }
}

/**
 * Autorizacion por permiso.
 *
 * Se ejecuta despues de `JwtAuthGuard`, de modo que la sesion con sus permisos ya
 * esta cargada. Deniega con 403 y no con 401: el token es valido, simplemente no
 * alcanza.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<string[]>(
      PERMISOS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin metadatos, este guard no restringe nada.
    if (!requeridos || requeridos.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SesionActual }>();
    const sesion = request.user;

    if (!sesion) {
      // El mensaje va explicito: `UnauthorizedException` sin texto responde en
      // ingles y el frontend no sabria si reintentar o llevar al login.
      throw new UnauthorizedException('Sesion no autenticada');
    }

    // Se exigen TODOS los permisos declarados: los endpoints se decoran con la
    // combinacion minima, y el AND es lo que evita que baste con uno de ellos.
    const concedidos = new Set(sesion.permissions);
    const faltan = requeridos.filter((p) => !concedidos.has(p));

    if (faltan.length > 0) {
      throw new ForbiddenException(
        `Permisos insuficientes: ${faltan.join(', ')}`,
      );
    }

    return true;
  }
}
