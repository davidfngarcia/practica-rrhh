import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginadoDto } from '../common/paginacion.js';
import { aBooleano } from '../common/transformaciones.js';

/**
 * Formato admitido en `codigo`.
 *
 * El mismo criterio que en `departamento.dto.ts`: caracteres que no se confunden
 * entre si y que no obligan a entrecomillar el valor en una consulta, y primer
 * caracter alfanumerico para que el codigo no pueda empezar por un guion como
 * promete el mensaje de error.
 */
const FORMATO_CODIGO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Longitudes tomadas de `puesto.entity.ts`. */
const MAX_CODIGO = 50;
const MAX_NOMBRE = 150;
const MAX_DESCRIPCION = 255;

/** Listado de puestos. */
export class ListarPuestosDto extends PaginadoDto {}

/** Alta de un puesto. */
export class CrearPuestoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CODIGO)
  @Matches(FORMATO_CODIGO, {
    message:
      'El codigo empieza por una letra o un numero, y solo admite letras, numeros, punto, guion y guion bajo',
  })
  codigo: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOMBRE)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPCION)
  descripcion?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;
}

/**
 * Modificacion de un puesto.
 *
 * Se declara a mano en vez de derivarla de `CrearPuestoDto` con `PartialType` de
 * `@nestjs/mapped-types`: ese paquete llega como dependencia indirecta de
 * `@nestjs/swagger` y no esta declarado en `package.json`.
 *
 * Todos los campos son opcionales y solo se actualizan los que vienen.
 */
export class ActualizarPuestoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CODIGO)
  @Matches(FORMATO_CODIGO, {
    message:
      'El codigo empieza por una letra o un numero, y solo admite letras, numeros, punto, guion y guion bajo',
  })
  codigo?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOMBRE)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPCION)
  descripcion?: string;

  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;
}
