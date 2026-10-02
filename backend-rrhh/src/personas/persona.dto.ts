import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EsFecha } from '../common/fechas.js';
import { PaginadoDto } from '../common/paginacion.js';
import { aBooleano } from '../common/transformaciones.js';

/**
 * Valores admitidos por `tipo_documento`.
 *
 * Son los que acepta el CHECK `ck_persona_tipo_documento` de la base. La lista se
 * repite aqui a proposito: si solo existiera en la base, un valor inventado llegaria
 * hasta MySQL y responderia con un error de constraint en ingles, sin decir que valores
 * son los validos.
 */
export const TIPOS_DOCUMENTO = ['CC', 'CE', 'NIT', 'PASAPORTE'] as const;

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/**
 * Valores admitidos por `genero`.
 *
 * `O` es la opcion prevista en la base para las personas que no se identifican con `M`
 * ni con `F`. Es preferible a dejar el campo libre: un valor mal escrito haria ruido en
 * las busquedas por genero, que es justo lo que el campo permite hacer.
 */
export const GENEROS = ['M', 'F', 'O'] as const;

export type Genero = (typeof GENEROS)[number];

/**
 * Formato admitido en `numero_documento`.
 *
 * Se admite el guion, que es como se escribe un documento, y el punto, que separa los
 * digitos de un NIT. Se exige al menos un digito: un documento solo con guiones no
 * identifica a nadie.
 */
const FORMATO_NUMERO_DOCUMENTO = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Longitudes tomadas de `persona.entity.ts`. */
const MAX_TIPO_DOCUMENTO = 20;
const MAX_NUMERO_DOCUMENTO = 50;
const MAX_NOMBRES = 100;
const MAX_APELLIDOS = 100;
const MAX_GENERO = 1;
const MAX_EMAIL = 150;
const MAX_TELEFONO = 30;
const MAX_DIRECCION = 255;

/** Mensajes compartidos por el alta y la modificacion. */
const MENSAJE_TIPO_DOCUMENTO = `El tipo de documento debe ser uno de: ${TIPOS_DOCUMENTO.join(', ')}`;
const MENSAJE_GENERO = `El genero debe ser uno de: ${GENEROS.join(', ')}`;
const MENSAJE_EMAIL = 'El correo electronico no tiene un formato valido';
const MENSAJE_ACTIVO = 'activo debe ser true o false';

/**
 * Listado de personas.
 *
 * Hereda de `PaginadoDto` la paginacion, la busqueda por texto libre y
 * `incluir_inactivos`, y anade los filtros que solo tienen sentido en un catalogo de
 * personas. Se declara con `extends` en vez de componer con `IntersectionType` por el
 * mismo motivo que no se usa `PartialType` de `@nestjs/mapped-types`.
 */
export class ListarPersonasDto extends PaginadoDto {
  /** Documento exacto, para buscar a una persona concreta sin recorrer el listado. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NUMERO_DOCUMENTO)
  // Se valida el formato igual que en el alta y el PATCH. El valor va directo al indice
  // ciego, asi que un documento mal formado nunca va a encontrar a nadie: sin esta
  // comprobacion el filtro responderia 200 con cero resultados, que parece "no existe
  // esa persona" cuando en realidad la peticion estaba mal.
  @Matches(FORMATO_NUMERO_DOCUMENTO, {
    message:
      'El numero de documento empieza por una letra o un numero, y solo admite letras, numeros, punto y guion',
  })
  numero_documento?: string;

  @IsOptional()
  @IsString()
  @IsIn(TIPOS_DOCUMENTO, { message: MENSAJE_TIPO_DOCUMENTO })
  tipo_documento?: TipoDocumento;

  @IsOptional()
  @IsString()
  @IsIn(GENEROS, { message: MENSAJE_GENERO })
  genero?: Genero;
}

/** Alta de una persona. */
export class CrearPersonaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TIPO_DOCUMENTO)
  @IsIn(TIPOS_DOCUMENTO, { message: MENSAJE_TIPO_DOCUMENTO })
  tipo_documento: TipoDocumento;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NUMERO_DOCUMENTO)
  @Matches(FORMATO_NUMERO_DOCUMENTO, {
    message:
      'El numero de documento empieza por una letra o un numero, y solo admite letras, numeros, punto y guion',
  })
  numero_documento: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOMBRES)
  nombres: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_APELLIDOS)
  apellidos: string;

  @IsOptional()
  @EsFecha()
  fecha_nacimiento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_GENERO)
  @IsIn(GENEROS, { message: MENSAJE_GENERO })
  genero?: Genero;

  @IsOptional()
  @IsEmail({}, { message: MENSAJE_EMAIL })
  @MaxLength(MAX_EMAIL)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TELEFONO)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DIRECCION)
  direccion?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: MENSAJE_ACTIVO })
  activo?: boolean;
}

/**
 * Modificacion de una persona.
 *
 * Se declara a mano, como `ActualizarDepartamentoDto`: todos los campos son
 * opcionales y solo se actualizan los que llegan, para que un `PATCH` con un solo
 * campo no vacie el resto.
 *
 * `tipo_documento` no aparece a proposito. El tipo forma parte de la identificacion de
 * la persona y el indice unico solo mira `numero_documento`, asi que permitir el cambio
 * dejaria dos personas distintas con el mismo numero y distinto tipo, y el documento
 * dejaria de identificar a nadie. Mandarlo devuelve el 400 habitual de "no es un campo
 * permitido", que es una respuesta honesta: el campo no se puede tocar por esta via.
 */
export class ActualizarPersonaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NUMERO_DOCUMENTO)
  @Matches(FORMATO_NUMERO_DOCUMENTO, {
    message:
      'El numero de documento empieza por una letra o un numero, y solo admite letras, numeros, punto y guion',
  })
  numero_documento?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOMBRES)
  nombres?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_APELLIDOS)
  apellidos?: string;

  @IsOptional()
  @EsFecha()
  fecha_nacimiento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_GENERO)
  @IsIn(GENEROS, { message: MENSAJE_GENERO })
  genero?: Genero;

  @IsOptional()
  @IsEmail({}, { message: MENSAJE_EMAIL })
  @MaxLength(MAX_EMAIL)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TELEFONO)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DIRECCION)
  direccion?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: MENSAJE_ACTIVO })
  activo?: boolean;
}
