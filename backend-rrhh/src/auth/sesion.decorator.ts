import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Claims del access token.
 *
 * `sub` es el `usuarios.id`, no el nombre de usuario: el resto del esquema se
 * referencia por UUID, y un nombre es un dato mutable.
 */
export interface Claims {
  /** usuarios.id */
  sub: string;
  /** Nombre de usuario, solo para mostrar. No usar para autorizar. */
  usuario: string;
  /** Empresa con la que opera esta sesion. */
  empresa_id: string;
  empresa_nombre: string;
  /** rol.id dentro de esa empresa. */
  rol_id: string;
  rol_codigo: string;
}

export interface SesionActual extends Claims {
  permissions: string[];
}

/** Usuario autenticado segun el token de la peticion. */
export const CurrentUser = createParamDecorator(
  (dato: keyof SesionActual | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SesionActual }>();
    const sesion = request.user;
    if (!sesion) return undefined;
    return dato ? sesion[dato] : sesion;
  },
);

/** Empresa de la sesion en curso. */
export const CurrentEmpresa = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SesionActual }>();
    return request.user?.empresa_id;
  },
);

/** Datos de la peticion que se guardan en auditoria. */
export function contextoPeticion(request: Request): {
  ip: string | null;
  user_agent: string | null;
} {
  return {
    // `trust proxy` ya esta activo en main.ts, asi que req.ip respeta X-Forwarded-For.
    ip: request.ip ?? null,
    user_agent: (request.headers['user-agent'] ?? null) as string | null,
  };
}
