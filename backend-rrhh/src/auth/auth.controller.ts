import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { configApp } from '../config/config.js';
import type { ConfigApp } from '../config/config.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { AuthService } from './auth.service.js';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { leerCookie } from './cookie.js';
import { CambiarEmpresaDto, LoginDto, RefreshDto } from './login.dto.js';
import { SesionesService } from './sesiones.service.js';
import type { RefreshEmitido } from './sesiones.service.js';
import { CurrentUser, contextoPeticion } from './sesion.decorator.js';
import type { Claims, SesionActual } from './sesion.decorator.js';
import { Public } from './guards.js';

/**
 * Cookie del refresh token.
 *
 * httpOnly la oculta al JavaScript de la pagina, que es el vector que roba tokens
 * de larga duracion (XSS). SameSite=Lax evita que viaje en peticiones hechas desde
 * otra web. `secure` se activa fuera de desarrollo, donde ademas el servidor suele
 * estar detras de TLS terminado en un proxy.
 */
const COOKIE_REFRESH = 'rt';

function opcionesCookie(config: ConfigApp) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.nodeEnv === 'production',
    path: '/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Empresa y rol con la que se abre la sesion. */
interface EmpresaElegida {
  empresa_id: string;
  empresa_nombre: string;
  rol_codigo: string;
}

interface RespuestaLogin {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  empresa: { id: string; nombre: string };
  rol: { id: string; codigo: string; nombre: string };
  empresas: Array<{ id: string; nombre: string; rol: string }>;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sesionesService: SesionesService,
    private readonly auditoriaService: AuditoriaService,
  ) {}

  /**
   * Login.
   *
   * Limitado a 5 intentos por minuto: sin esto, un atacante puede probar
   * credenciales contra la base a velocidad de red. Responde siempre 401 con el
   * mismo mensaje para no revelar que cuentas existen.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: configApp().throttleLogin, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RespuestaLogin> {
    const contexto = contextoPeticion(request);

    let user: Usuario;
    try {
      user = await this.authService.validarCredenciales(
        dto.usuario,
        dto.password,
      );
    } catch (error) {
      await this.auditoriaService.auditar(
        {
          accion: 'LOGIN_FALLIDO',
          entidad: 'usuario',
          datos_despues: { usuario: dto.usuario },
        },
        contexto,
      );
      throw error;
    }

    const empresas = await this.authService.listarEmpresas(user.id);

    // Un usuario sin ninguna empresa activa puede autenticarse, pero no recibe
    // token: un JWT sin empresa no tendria contra que proteger los datos.
    if (empresas.length === 0) {
      await this.auditoriaService.auditar(
        {
          accion: 'LOGIN_FALLIDO',
          usuario_id: user.id,
          entidad: 'usuario',
          entidad_id: user.id,
          datos_despues: { motivo: 'SIN_EMPRESAS_ACTIVAS' },
        },
        contexto,
      );
      throw new UnauthorizedException(
        'El usuario no tiene acceso a ninguna empresa activa',
      );
    }

    const elegida = this.elegirEmpresa(empresas, dto.empresa_id);

    return this.entregarToken(user, elegida, empresas, response, contexto);
  }

  /** Renueva el access token. El refresh rota y el anterior queda invalidado. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: configApp().throttleRefresh, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
  }> {
    const contexto = contextoPeticion(request);
    const token =
      dto.refresh_token ?? leerCookie(request.headers.cookie, COOKIE_REFRESH);

    if (!token) {
      throw new UnauthorizedException('Falta el refresh token');
    }

    const emitido = await this.sesionesService.rotar(token, contexto);
    const claims = await this.authService.claimsDeSesion(emitido.registro);
    const acceso = await this.authService.firmarAcceso(claims);

    response.cookie(COOKIE_REFRESH, emitido.token, opcionesCookie(configApp()));

    return acceso;
  }

  /** Cierra la sesion: revoca la familia completa de refresh tokens. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = leerCookie(request.headers.cookie, COOKIE_REFRESH);

    if (token) {
      await this.sesionesService.revocar(token, 'LOGOUT');
    }

    response.clearCookie(COOKIE_REFRESH, {
      ...opcionesCookie(configApp()),
      maxAge: undefined,
    });

    return;
  }

  /** Sesion actual, tal y como la ve el frontend. */
  @Get('me')
  async me(@CurrentUser() sesion: SesionActual) {
    return {
      usuario: sesion.usuario,
      usuario_id: sesion.sub,
      empresa: { id: sesion.empresa_id, nombre: sesion.empresa_nombre },
      rol: { id: sesion.rol_id, codigo: sesion.rol_codigo },
      permisos: sesion.permissions,
    };
  }

  /** Empresas disponibles para este usuario. */
  @Get('empresas')
  async empresas(@CurrentUser('sub') usuarioId: string) {
    return this.authService.listarEmpresas(usuarioId);
  }

  /**
   * Emite un token para otra empresa. Abre una familia de refresh nueva, para que
   * cambiar de empresa no deje el refresh anterior valido.
   */
  @Post('cambiar-empresa')
  @HttpCode(HttpStatus.OK)
  async cambiarEmpresa(
    @Body() dto: CambiarEmpresaDto,
    @CurrentUser() sesion: SesionActual,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RespuestaLogin> {
    const contexto = contextoPeticion(request);
    const user = await this.authService.buscarPorId(sesion.sub);

    // Se comprueba la membresia ANTES de auditar: `auditoria.empresa_id` tiene FK a
    // `empresa`, asi que registrar una empresa que no existe solo produciria un
    // error de auditoria en el intento de cambiar a una empresa ajena.
    const empresas = await this.authService.listarEmpresas(user.id);
    const elegida = this.elegirEmpresa(empresas, dto.empresa_id);

    // El token que abria la sesion en la empresa anterior deja de servir. Sin esto, un
    // refresh capturado seguiría renovando el acceso a la empresa de origen.
    //
    // La revocacion y la emision del nuevo van juntas en una transaccion
    // (`cambiarEmpresa`). Separadas dejaban un hueco: si la emision fallaba despues de
    // revocar, el usuario se quedaba sin ningun refresh, habia recibido un error y
    // habia perdido la sesion por pedir un cambio de empresa.
    const refreshActual = leerCookie(request.headers.cookie, COOKIE_REFRESH);
    const emitido = await this.sesionesService.cambiarEmpresa(
      refreshActual,
      user.id,
      elegida.empresa_id,
      contexto,
    );

    await this.auditoriaService.auditar(
      {
        // `CAMBIO_EMPRESA` y no `LOGOUT`: el usuario no cerro su sesion, pidio un token
        // para otra empresa. La revocacion del refresh anterior es un efecto de eso, no
        // el motivo, y registrarla como `LOGOUT` esconderia en el log los movimientos
        // entre empresas hechos sin cerrar sesion.
        accion: 'CAMBIO_EMPRESA',
        usuario_id: user.id,
        empresa_id: elegida.empresa_id,
        entidad: 'usuario_empresa',
        entidad_id: elegida.empresa_id,
        datos_antes: { empresa_id: sesion.empresa_id },
        datos_despues: { empresa_id: elegida.empresa_id },
      },
      contexto,
    );

    return this.entregarToken(
      user,
      elegida,
      empresas,
      response,
      contexto,
      emitido ?? undefined,
    );
  }

  /** Firma el access token y deja la cookie de refresh puesta.
   *
   * `emitido` permite reutilizar un refresh que ya se haya creado antes, como hace el
   * cambio de empresa, donde revocarlo y emitirlo tienen que ir en la misma transaccion
   * que esta llamada. Sin ese parametro, aqui se emitiria uno nuevo y quedarian dos.
   */
  private async entregarToken(
    user: Usuario,
    empresa: EmpresaElegida,
    empresas: EmpresaElegida[],
    response: Response,
    contexto: ContextoPeticion,
    emitido?: RefreshEmitido,
  ): Promise<RespuestaLogin> {
    const rol = await this.authService.rolDe(user.id, empresa.empresa_id);

    const claims: Claims = {
      sub: user.id,
      usuario: user.usuario,
      empresa_id: empresa.empresa_id,
      empresa_nombre: empresa.empresa_nombre,
      rol_id: rol.id,
      rol_codigo: rol.codigo,
    };

    const acceso = await this.authService.firmarAcceso(claims);

    const refreshEmitido =
      emitido ??
      (await this.sesionesService.emitir(
        user.id,
        empresa.empresa_id,
        null,
        contexto,
      ));
    response.cookie(
      COOKIE_REFRESH,
      refreshEmitido.token,
      opcionesCookie(configApp()),
    );

    await this.authService.registrarAcceso(user.id);
    await this.auditoriaService.auditar(
      {
        accion: 'LOGIN',
        usuario_id: user.id,
        empresa_id: empresa.empresa_id,
        entidad: 'usuario',
        entidad_id: user.id,
        datos_despues: { empresa_id: empresa.empresa_id, rol: rol.codigo },
      },
      contexto,
    );

    return {
      ...acceso,
      empresa: { id: empresa.empresa_id, nombre: empresa.empresa_nombre },
      rol: { id: rol.id, codigo: rol.codigo, nombre: rol.nombre },
      empresas: empresas.map((e) => ({
        id: e.empresa_id,
        nombre: e.empresa_nombre,
        rol: e.rol_codigo,
      })),
    };
  }

  /**
   * Decide con que empresa se abre sesion.
   *
   * Si el usuario tiene varias y no indica ninguna, es un error: elegir por el
   * servidor haria que el cliente terminara operando sobre datos de una empresa
   * que no pretendia.
   */
  private elegirEmpresa(
    empresas: EmpresaElegida[],
    pedida: string | undefined,
  ): EmpresaElegida {
    if (!pedida) {
      if (empresas.length > 1) {
        throw new UnauthorizedException(
          'El usuario pertenece a varias empresas. Indica empresa_id.',
        );
      }
      return empresas[0];
    }

    const elegida = empresas.find((e) => e.empresa_id === pedida);
    if (!elegida) {
      throw new UnauthorizedException('No tienes acceso a la empresa indicada');
    }

    return elegida;
  }
}
