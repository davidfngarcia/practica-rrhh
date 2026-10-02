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
 * Se limita a caracteres que no se confunden entre si y que no obligan a
 * entrecomillar el valor en una consulta: un codigo con espacios o comillas
 * complica cada uso posterior.
 *
 * El primer caracter tiene que ser alfanumerico porque el mensaje de error dice que el
 * codigo no puede empezar por un guion, y el mensaje es la promesa que ve el cliente:
 * si la expresion lo permitiera, un codigo como `-RR` se guardaria aunque el frontend
 * ya habria dicho que no era posible. De paso evita que un codigo se confunda con la
 * opcion de una linea de ordenes cuando algun dia se pase por parametro.
 */
const FORMATO_CODIGO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Longitudes tomadas de `departamento.entity.ts`. */
const MAX_CODIGO = 50;
const MAX_NOMBRE = 150;
const MAX_DESCRIPCION = 255;

/** Listado de departamentos. */
export class ListarDepartamentosDto extends PaginadoDto {}

/** Alta de un departamento. */
export class CrearDepartamentoDto {
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
 * Modificacion de un departamento.
 *
 * Se declara a mano en vez de derivarla de `CrearDepartamentoDto` con `PartialType`
 * de `@nestjs/mapped-types`: ese paquete llega como dependencia indirecta de
 * `@nestjs/swagger`, y no esta declarado en `package.json`. Importarlo seria
 * depender de algo que un `npm install` puede dejar de traer.
 *
 * Todos los campos son opcionales y solo se actualizan los que vienen: un PATCH
 * con `{ activo: false }` no debe borrar la descripcion.
 */
export class ActualizarDepartamentoDto {
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
