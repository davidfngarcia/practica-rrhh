/**
 * Mensajes de error en castellano.
 *
 * NestJS y `class-validator` responden en ingles. En una API usada por un equipo
 * hispanohablante, un `{"message":"password must be longer than or equal to 200
 * characters"}` obliga a ir a mirar el DTO para entender que campo falla. Este
 * modulo traduce los mensajes de validacion y da forma unica a los errores HTTP.
 *
 * No se traducen los codigos HTTP ni los nombres de los campos: esos los consume
 * el frontend programaticamente y traducirlos romperia el contrato.
 */
import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ValidationPipeOptions } from '@nestjs/common/pipes/validation.pipe';
import { Request, Response } from 'express';

/** Error de validacion ya traducido y aplanado. */
export interface ErrorValidacion {
  campo: string;
  mensaje: string;
}

/**
 * Traduccion de los mensajes de `class-validator`.
 *
 * Se indexa por el nombre del validador (`isString`, `maxLength`...) y no por el
 * texto completo del mensaje, porque el mensaje incluye los limites concretos
 * (`must be longer than 5 characters`), que varian en cada DTO.
 */
const TRADUCCIONES: Record<string, string> = {
  isString: 'debe ser texto',
  isInt: 'debe ser un numero entero',
  isNumber: 'debe ser un numero',
  isBoolean: 'debe ser verdadero o falso',
  isArray: 'debe ser una lista',
  isObject: 'debe ser un objeto',
  isUuid: 'debe ser un identificador UUID',
  isEmail: 'debe ser un correo electronico valido',
  isDate: 'debe ser una fecha valida',
  isNotEmpty: 'no puede estar vacio',
  isEmpty: 'debe estar vacio',
  equals: 'no coincide con el valor esperado',
  contains: 'debe contener el valor indicado',
  isIn: 'debe ser uno de los valores permitidos',
  matches: 'no tiene el formato esperado',
  isPositive: 'debe ser mayor que cero',
  isNegative: 'debe ser menor que cero',
  arrayNotEmpty: 'no puede ser una lista vacia',
  // Validaciones internas del pipe, no decoradores del DTO.
  whitelistValidation: 'no es un campo permitido',
  forbiddenPropertyValidation: 'no es un campo permitido',
};

/**
 * Mensajes con el limite ya incorporado.
 *
 * El limite se extrae del mensaje original de `class-validator`
 * (`must be longer than 5 characters`) y se reinserta en castellano. Va aparte de
 * `TRADUCCIONES` porque el texto depende de si el limite es un maximo o un minimo.
 */
const TRADUCCIONES_CON_LIMITE: Record<string, (limite: number) => string> = {
  maxLength: (l) => `no puede superar los ${l} caracteres`,
  minLength: (l) => `debe tener al menos ${l} caracteres`,
  max: (l) => `no puede ser mayor que ${l}`,
  min: (l) => `no puede ser menor que ${l}`,
  arrayMaxSize: (l) => `no puede tener mas de ${l} elementos`,
  arrayMinSize: (l) => `debe tener al menos ${l} elementos`,
};

/**
 * Traduce una restriccion de `class-validator`.
 *
 * `restriccion` es el nombre tecnico del validador que fallo, que es justo lo que
 * permite elegir la traduccion sin depender del idioma del mensaje original.
 */
function traducirRestriccion(
  restriccion: string,
  /** Limite declarado en el decorador, para conservarlo en el mensaje. */
  limite?: number,
): string {
  const conLimite =
    limite === undefined ? undefined : TRADUCCIONES_CON_LIMITE[restriccion];

  if (conLimite && limite !== undefined) {
    return conLimite(limite);
  }

  const base = TRADUCCIONES[restriccion];

  // Sin traduccion conocida se devuelve el codigo: es mas util que el mensaje en
  // ingles porque identifica de forma unica que validador fallo.
  if (!base) {
    return `no cumple la regla ${restriccion}`;
  }

  return base;
}

/** Motivos de rechazo de un campo, ya traducidos. */
function motivosDe(error: ValidationError, campo: string): ErrorValidacion[] {
  const reglas = Object.entries(error.constraints ?? {});

  // Sin reglas propias solo puede fallar el grupo entero, que se explica con sus
  // hijos. Sin hijos tampoco, y entonces no hay nada que traduire.
  if (reglas.length === 0) {
    return error.children?.length
      ? []
      : [{ campo, mensaje: 'valor no valido' }];
  }

  // Se distingue el texto por defecto de `class-validator` de uno escrito en el DTO
  // para separar los dos casos: el primero se traduce, el segundo se respeta tal
  // cual.
  //
  // Los mensajes por defecto empiezan por el nombre del campo
  // ("usuario must be a string"), salvo dos formas que empiezan de otra manera
  // (`all elements in ...` de `isIn` y `property ... should not exist` del pipe). Un
  // mensaje propio puede mencionar el campo sin problema: lo que importa es que no
  // empiece por el.
  const esPredeterminado = (texto: string) =>
    texto.startsWith(`${error.property} `) || /^(all |property )/.test(texto);

  const esPropio = (texto: string) => !esPredeterminado(texto);

  const ausente = error.value === undefined || error.value === null;

  // `class-validator` ejecuta tambien las reglas de longitud sobre un valor
  // ausente, y eso produce ruido del tipo "no puede superar los 128 caracteres" para
  // un campo que simplemente no llego. Como `@IsOptional()` hace que un campo
  // opcional no produzca ninguna regla, aqui solo puede tratarse de uno
  // obligatorio: se avisa una vez y basta.
  if (ausente) {
    const propios = reglas
      .filter(([, texto]) => esPropio(texto))
      .map(([, texto]) => ({ campo, mensaje: texto }));

    return propios.length > 0
      ? propios
      : [{ campo, mensaje: 'es obligatorio' }];
  }

  return reglas.map(([restriccion, texto]) => {
    if (esPropio(texto)) {
      return { campo, mensaje: texto };
    }

    // El limite va dentro del mensaje original (`must be longer than 5
    // characters`), asi que se recupera de ahi en vez de introspeccionar el DTO.
    const bruto =
      /longer than or equal to (\S+)/.exec(texto)?.[1] ??
      /shorter than or equal to (\S+)/.exec(texto)?.[1];
    const limite = bruto === undefined ? undefined : Number(bruto);

    return {
      campo,
      mensaje: traducirRestriccion(
        restriccion,
        Number.isFinite(limite) ? limite : undefined,
      ),
    };
  });
}

/**
 * Aplana el arbol de `class-validator` a una lista de campos con su motivo.
 *
 * `class-validator` anida los errores cuando hay DTOs dentro de otros; esta funcion
 * los deja en una lista plana `padre.hoja` para que el frontend pueda pintar los
 * errores junto a cada input sin recorrer un arbol.
 */
function aplanar(errores: ValidationError[], prefijo = ''): ErrorValidacion[] {
  return errores.flatMap((error) => {
    const campo = prefijo ? `${prefijo}.${error.property}` : error.property;

    return [
      ...motivosDe(error, campo),
      ...aplanar(error.children ?? [], campo),
    ];
  });
}

/** Nombre en castellano del error HTTP, para el campo `error`. */
const NOMBRES_ERROR: Record<number, string> = {
  400: 'Peticion incorrecta',
  401: 'No autenticado',
  403: 'Sin permisos',
  404: 'No encontrado',
  409: 'Conflicto',
  422: 'Entidad no procesable',
  429: 'Demasiadas peticiones',
  500: 'Error interno del servidor',
  503: 'Servicio no disponible',
};

/**
 * Mensajes que emite el framework en ingles, con su equivalente.
 *
 * Se comparan de forma exacta: en cuanto el mensaje difiere es que el controlador
 * lo ha escrito a proposito, y entonces se respeta su redaccion.
 */
const MENSAJES_FRAMEWORK: Record<string, string> = {
  // `ThrottlerGuard` lanza esta excepcion sin texto propio.
  'ThrottlerException: Too Many Requests':
    'Demasiadas peticiones. Espera unos segundos antes de reintentar.',
};

/**
 * `Cannot GET /ruta`, el 404 que genera el enrutador de Nest al no encontrar
 * ninguna combinacion de metodo y ruta.
 */
const RE_RUTA_INEXISTENTE = /^Cannot ([A-Z]+) (.+)$/;

/**
 * Filtro global: da a todos los errores la misma forma JSON.
 *
 * Sin el, un `HttpException` del controlador devuelve `{ message, statusCode }` y
 * uno de validacion devuelve `{ message: [ ... ], error, statusCode }`. El
 * frontend tendria que distinguir dos formatos distintos para lo mismo.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger(FiltroErrores.name);

  /**
   * `BadRequestException`, `UnauthorizedException`... ya llevan el texto en
   * castellano que se les pasa en el constructor. Aqui solo se traducen los que
   * nacen en ingles dentro del framework.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const respuesta = ctx.getResponse<Response>();
    const peticion = ctx.getRequest<Request>();

    const estado = this.estadoDe(exception);

    if (estado >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Un 5xx es un fallo nuestro: se registra con contexto para poder
      // diagnosticarlo. El cliente recibe un mensaje generico, sin detalles
      // internos que puedan filtrar informacion del servidor.
      this.logger.error(
        `${peticion.method} ${peticion.originalUrl} -> ${estado}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    respuesta
      .status(estado)
      .json({ ...this.cuerpo(exception, estado), statusCode: estado });
  }

  /**
   * Estado HTTP que corresponde a la excepcion.
   *
   * Los errores del parser de JSON de Express (`body-parser`) no son
   * `HttpException`: llegan con un `status` propio. Sin contemplarlos, un cuerpo
   * mal formado se responderia como 500 y ademas se registraria como fallo del
   * servidor, cuando el error es del cliente.
   */
  private estadoDe(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();

    const crudo =
      (exception as { status?: unknown; statusCode?: unknown }) ?? {};
    const candidato = Number(crudo.status ?? crudo.statusCode);

    return Number.isInteger(candidato) && candidato >= 400 && candidato <= 499
      ? candidato
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /** Cuerpo del error, sin el `statusCode`, que lo añade `catch`. */
  private cuerpo(exception: unknown, estado: number): Record<string, unknown> {
    const base = { error: NOMBRES_ERROR[estado] ?? 'Error' };

    // El JSON mal formado no llega aqui: lo responde `common/cuerpo.ts`, que
    // registra el parser. Este filtro solo ve errores de la aplicacion.
    if (exception instanceof HttpException) {
      const respuesta = exception.getResponse();

      // `getResponse()` devuelve un texto plano cuando la excepcion se creo sin
      // cuerpo, que es el caso de `ThrottlerException`.
      if (typeof respuesta === 'string') {
        return { ...base, message: this.traducir(respuesta) };
      }

      // Una validacion fallida trae ya la lista de campos y motivos.
      if (typeof respuesta === 'object' && respuesta !== null) {
        const detalle = respuesta as { errores?: unknown; message?: unknown };

        if (Array.isArray(detalle.errores)) {
          return {
            ...base,
            message: 'Los datos enviados no son validos',
            errores: detalle.errores,
          };
        }

        // `message` puede ser texto o lista: se normaliza a texto.
        if (Array.isArray(detalle.message)) {
          return {
            ...base,
            message: detalle.message
              .map((m) => this.traducir(String(m)))
              .join(', '),
          };
        }

        if (typeof detalle.message === 'string') {
          return { ...base, message: this.traducir(detalle.message) };
        }
      }
    }

    // No es un HttpException: fallo no controlado. Se registra en `catch` y aqui
    // solo se devuelve una frase generica, sin detalles internos.
    return { ...base, message: 'Error interno del servidor' };
  }

  /**
   * Sustituye los mensajes del framework por su equivalente en castellano.
   *
   * Cualquier otro texto se devuelve tal cual: es el que ha escrito el
   * controlador, y decidir si esta "bien redactado" es trabajo suyo.
   */
  private traducir(mensaje: string): string {
    const conocido = MENSAJES_FRAMEWORK[mensaje];
    if (conocido) return conocido;

    const ruta = RE_RUTA_INEXISTENTE.exec(mensaje);
    if (ruta) {
      return `La ruta ${ruta[1]} ${ruta[2]} no existe`;
    }

    return mensaje;
  }
}

/**
 * `ValidationPipe` con los mensajes ya en castellano.
 *
 * `exceptionFactory` devuelve la lista de `{ campo, mensaje }` que el filtro
 * reconoce y devuelve tal cual, en lugar del texto plano que emite Nest.
 */
export function pipeValidacion(): ValidationPipe {
  const opciones: ValidationPipeOptions = {
    whitelist: true,
    // Rechaza propiedades no declaradas en el DTO en vez de ignorarlas.
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errores: ValidationError[]) =>
      new HttpException(
        {
          message: 'Los datos enviados no son validos',
          errores: aplanar(errores),
        },
        HttpStatus.BAD_REQUEST,
      ),
  };

  return new ValidationPipe(opciones);
}

/**
 * 404 para un registro que no existe en la empresa de la sesion.
 *
 * El mensaje no distingue entre "no existe" y "existe en otra empresa": desde el
 * punto de vista de quien llama, en su empresa no esta, y decirlo de otro modo
 * permitiria sondear la existencia de registros ajenos.
 */
export function noEncontrado(entidad: string, id: string): NotFoundException {
  // Se repite el id que ya envio el cliente: no revela nada que no supiera, y
  // ayuda a distinguir un 404 de un id equiviado al copiarlo.
  return new NotFoundException(`No existe ${entidad} con id ${id}`);
}

/**
 * 409 para un choque con una restriccion de unicidad.
 *
 * El mensaje lo redacta quien la detecta, porque cada caso es distinto: un codigo
 * repetido no dice lo mismo que un NIF ya registrado.
 */
export function conflicto(mensaje: string): ConflictException {
  return new ConflictException(mensaje);
}
