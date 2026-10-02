import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Auditoria } from '../database/entities/auditoria.entity.js';
import { ocultarSensibles } from './redaccion.js';

/**
 * Acciones que admite el CHECK de `auditoria.accion`.
 *
 * El tipo es la garantia de que no se puede auditar una accion inventada: si se
 * anade una aqui, hay que modificar el CHECK de la tabla tambien.
 */
export type AccionAuditoria =
  | 'CREAR'
  | 'ACTUALIZAR'
  | 'ELIMINAR'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FALLIDO'
  | 'CAMBIO_ROL'
  | 'CAMBIO_PERMISOS'
  | 'CAMBIO_EMPRESA';

/** Contexto de peticion para auditar. */
export interface ContextoPeticion {
  ip?: string | null;
  user_agent?: string | null;
}

/** Una escritura de auditoria. */
export interface EventoAuditoria {
  accion: AccionAuditoria;
  /** Usuario causante. `null` para acciones propias del sistema. */
  usuario_id?: string | null;
  /** Empresa sobre la que se opera. */
  empresa_id?: string | null;
  /** Tabla o modulo afectado: `departamento`, `puesto`, `usuario`... */
  entidad: string;
  entidad_id?: string | null;
  datos_antes?: Record<string, unknown> | null;
  datos_despues?: Record<string, unknown> | null;
}

/**
 * Registro de auditoria.
 *
 * Vive fuera de `AuthModule` porque lo usan todos los modulos de negocio: si
 * viviera en el servicio de autenticacion, cada modulo tendria que importar el
 * modulo de JWT y Passport para escribir una fila de auditoria.
 */
@Injectable()
export class AuditoriaService {
  constructor(
    @InjectRepository(Auditoria)
    private readonly auditoria: Repository<Auditoria>,
  ) {}

  /**
   * Escribe un evento de auditoria. Nunca debe romper el flujo principal.
   *
   * Si la escritura falla, el error se registra en el log pero no se propaga: la
   * operacion de negocio ya se ha hecho, y responder con un error al cliente
   * haria creer que no.
   */
  async auditar(
    datos: EventoAuditoria,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    try {
      await this.auditoria.insert({
        id: crypto.randomUUID(),
        // Las relaciones se pasan como referencia parcial con la PK: insertar el
        // UUID suelto no cumple el tipo de la entidad.
        usuario_id: datos.usuario_id ? { id: datos.usuario_id } : null,
        empresa_id: datos.empresa_id ? { id: datos.empresa_id } : null,
        accion: datos.accion,
        entidad: datos.entidad,
        entidad_id: datos.entidad_id ?? null,
        // TypeORM tipa las columnas `json` como `() => string | DeepPartial<T>`, y
        // `DeepPartial<Record<string, unknown>>` no admite un `Record` plano. El
        // driver serializa el objeto, asi que no hace falta convertirlo a texto.
        //
        // `ocultarSensibles` se aplica aqui y no en el servicio que audita: documento,
        // salario e IBAN llegan descifrados, y escribirlos tal cual dejaria datos
        // sensibles en texto claro en la propia tabla de auditoria.
        ...(datos.datos_antes
          ? {
              datos_antes: ocultarSensibles(
                datos.datos_antes,
              ) as unknown as () => string,
            }
          : {}),
        ...(datos.datos_despues
          ? {
              datos_despues: ocultarSensibles(
                datos.datos_despues,
              ) as unknown as () => string,
            }
          : {}),
        ip: contexto?.ip ?? null,
        user_agent: contexto?.user_agent?.slice(0, 255) ?? null,
      });
    } catch (error) {
      // Un log fallido no debe tumbar la peticion, pero tampoco puede pasar
      // inadvertido: queda en el log de la aplicacion.
      console.error('No se pudo escribir la auditoria:', error);
    }
  }
}
