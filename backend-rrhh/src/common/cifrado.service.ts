/**
 * Cifrado en reposo de columnas sensibles y su indice ciego.
 *
 * Documento de identidad, salario y datos bancarios no se guardan en claro: una copia
 * de la base no debe bastar para reconstruir la nomina ni el IBAN de nadie.
 *
 * Dos piezas, porque por si solas no resuelven el problema:
 *
 * 1. `cifrar()` cifra con AES-256-GCM. Cada cifrado usa un IV aleatorio, asi que el
 *    mismo documento produce siempre un texto distinto. Eso protege de verdad, pero
 *    significa que dos filas con el mismo documento NO tienen el mismo cifrado, y por
 *    tanto no se pueden localizar ni impedir por indice.
 *
 * 2. `indiceCiego()` deriva un HMAC-SHA256 del valor. Es determinista, de modo que si
 *    dos filas comparten indice comparten documento, y sobre el se puede poner un
 *    UNIQUE o un `WHERE`. No es reversible: con la base en la mano no se obtiene el
 *    documento original, y sin la clave tampoco se puede comprobar a fuerza bruta.
 *
 * El coste asumido es que sobre un cifrado no se puede buscar por fragmento. El indice
 * ciego solo responde a igualdad exacta. Buscar "1234" dentro de un documento deja de
 * funcionar, y es el precio de no guardar el documento en claro.
 */
import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { configApp } from '../config/config.js';

/** Longitud del IV de GCM. */
const LONGITUD_IV = 12;
/** Longitud del tag de autenticacion de GCM. */
const LONGITUD_TAG = 16;
/** Version del formato, para poder cambiar el algoritmo sin descifrar de golpe. */
const VERSION = 'v1';

/**
 * Contextos de los indices ciegos.
 *
 * Van declarados aqui y no en el servicio que los usa porque los consume mas de uno: el
 * documento de la persona lo calculan `PersonasService` y `EmpleadosService`, y si cada
 * uno escribiera su propia cadena, un cambio en una acabaria dejando al otro
 * silenciosamente busccando por un indice que nadie escribe, devolviendo siempre cero
 * resultados y sin error que lo delate.
 */
export const CONTEXTO_DOCUMENTO_PERSONA = 'persona.numero_documento';
/**
 * Contexto del indice ciego del IBAN. Distinto del del documento de la persona: es el
 * mismo HMAC sobre datos que no tienen nada que ver, y un indice compartido permitiria
 * deducir que dos empleados comparten cuenta, o que una persona es un empleado.
 */
export const CONTEXTO_IBAN_EMPLEADO = 'empleado.iban';

@Injectable()
export class CifradoService {
  private readonly clave: Buffer;
  /**
   * Clave del indice ciego, derivada con un contexto propio para que el HMAC de los
   * indices no sirva como clave de cifrado aunque alguien se apoderase de uno.
   */
  private readonly claveIndice: Buffer;

  constructor() {
    const semilla = configApp().dataEncryptionKey;
    this.clave = createHash('sha256').update(semilla, 'utf8').digest();
    this.claveIndice = createHmac('sha256', semilla)
      .update('indice-ciego:v1')
      .digest();
  }

  /**
   * Cifra un texto.
   *
   * El IV se sortea en cada llamada a proposito: reutilizarlo con la misma clave sobre
   * dos textos distintos es justamente lo que rompe el modo GCM. El formato es
   * `v1:<base64(iv)>:<base64(tag)>:<base64(cifrado)>`; los tres ultimos van en base64
   * porque son binarios y no se pueden imprimir tal cual.
   */
  cifrar(texto: string): string {
    const iv = randomBytes(LONGITUD_IV);
    const cifrador = createCipheriv('aes-256-gcm', this.clave, iv);

    const cifrado = Buffer.concat([
      cifrador.update(texto, 'utf8'),
      cifrador.final(),
    ]);
    const tag = cifrador.getAuthTag();

    return [
      VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      cifrado.toString('base64'),
    ].join(':');
  }

  /**
   * Descifra un texto producido por `cifrar()`.
   *
   * Si el tag no cuadra, el dato fue alterado o la clave ya no es la misma, y GCM
   * lanza. Se deja subir el error sin envolver: un fallo de descifrado no es algo que
   * deba traducirse a un 400 de validacion, significa que lo que hay en la base esta
   * corrupto o que la clave ha rotado sin migrar los datos.
   */
  descifrar(valor: string): string {
    const partes = valor.split(':');

    if (partes.length !== 4 || partes[0] !== VERSION) {
      throw new Error('El valor cifrado no tiene un formato reconocido');
    }

    const iv = Buffer.from(partes[1], 'base64');
    const tag = Buffer.from(partes[2], 'base64');
    const cifrado = Buffer.from(partes[3], 'base64');

    if (iv.length !== LONGITUD_IV || tag.length !== LONGITUD_TAG) {
      throw new Error('El valor cifrado esta incompleto o truncado');
    }

    const descifrador = createDecipheriv('aes-256-gcm', this.clave, iv);
    descifrador.setAuthTag(tag);

    return Buffer.concat([
      descifrador.update(cifrado),
      descifrador.final(),
    ]).toString('utf8');
  }

  /**
   * Indice ciego: hash determinista de un valor, para poder igualar sin guardar el
   * original.
   *
   * Se recortan los espacios de los extremos y se pasa a mayusculas, para que " cc12" y
   * "CC12" sean la misma persona a efectos de indice. Los espacios **internos** si
   * cuentan: "CC12" y "CC 12" son indices distintos, y es lo correcto, porque el dato que
   * se guarda es el que llego. Quitar tambien los internos haria que dos documentos que
   * distintos a proposito se convergieran en un indice unico.
   *
   * `contexto` evita que el mismo dato en dos columnas distintas (`numero_documento` e
   * `iban`, por ejemplo) produzca el mismo indice.
   *
   * Un error al escribir el contexto produce un indice distinto del esperado, y el
   * efecto es que un filtro devuelve siempre cero resultados sin lanzar ningun error.
   * Por eso los contextos estan declarados arriba como constantes, no escritos en cada
   * llamada.
   */
  indiceCiego(contexto: string, valor: string): string {
    return createHmac('sha256', this.claveIndice)
      .update(`${contexto}:${valor.trim().toUpperCase()}`, 'utf8')
      .digest('hex');
  }
}
