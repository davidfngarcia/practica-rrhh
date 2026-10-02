import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { configApp } from '../config/config.js';

/**
 * Hash de refresh tokens.
 *
 * Un refresh token es una credencial portadora: quien lo posee acts como el
 * usuario. Por eso nunca se guarda en claro. Se almacena un HMAC-SHA256 del token,
 * con `DATA_HASH_KEY` como pepper, en hexadecimal (64 caracteres, que es lo que
 * cabe en `refresh_token.token_hash` CHAR(64)).
 *
 * Un SHA-256 simple no serviria: los tokens se generan con 256 bits de entropia,
 * asi que no se pueden precomputar, pero el pepper protege ademas contra el caso de
 * que la base se filtre y se quiera recuperar un token concreto.
 */
@Injectable()
export class TokenHashService {
  private readonly llave: string;

  constructor() {
    this.llave = configApp().dataHashKey;
  }

  /** Token opaco de 256 bits en base64url. */
  generarToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Identificador de la familia de rotacion. */
  generarFamilia(): string {
    return randomUUID();
  }

  hash(token: string): string {
    return createHmac('sha256', this.llave).update(token).digest('hex');
  }
}
