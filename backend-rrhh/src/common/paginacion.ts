import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { aBooleano } from './transformaciones.js';

/**
 * Tope de elementos por pagina.
 *
 * Sin limite, `por_pagina=1000000` permitiria leer la tabla entera en memoria con
 * una sola peticion.
 */
export const POR_PAGINA_MAXIMO = 100;

/** Pagina actual, empezando en 1. */
export const PAGINA_POR_DEFECTO = 1;

/** Elementos por pagina si no se indica otro. */
export const POR_PAGINA_POR_DEFECTO = 20;

/**
 * Parametros de paginacion y busqueda de un listado.
 *
 * Los valores por defecto viven aqui y no en la base de datos, asi que el DTO se
 * puede usar tambien para validar una peticion sin parametros.
 */
export class PaginadoDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La pagina debe ser un numero entero' })
  @Min(1, { message: 'La pagina empieza en 1' })
  pagina: number = PAGINA_POR_DEFECTO;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La cantidad por pagina debe ser un numero entero' })
  @Min(1, { message: 'Debe pedirse al menos un elemento por pagina' })
  @Max(POR_PAGINA_MAXIMO, {
    message: `No se pueden pedir mas de ${POR_PAGINA_MAXIMO} elementos por pagina`,
  })
  por_pagina: number = POR_PAGINA_POR_DEFECTO;

  /**
   * Texto a buscar en codigo o nombre.
   *
   * No se busca en la descripcion: es texto libre y su busqueda no es util para
   * elegir un registro de una lista.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100, {
    message: 'La busqueda no puede superar los 100 caracteres',
  })
  buscar?: string;

  /**
   * Incluye los registros dados de baja con `activo = 0`.
   *
   * `activo` y `deleted_at` son cosas distintas: `activo` es una baja logica que el
   * usuario puede deshacer, mientras que `deleted_at` es una eliminacion. Por
   * defecto el listado enseña solo lo que esta en uso.
   *
   * Sin el `@Transform`, este filtro no funcionaria: al no haber anotacion de tipo
   * el `design:type` emitido es `Object` y `"true"` seguiria siendo texto, que
   * `@IsBoolean` rechaza; con la anotacion, la conversion implicita de
   * `ValidationPipe` la resuelve como `Boolean(valor)`, que da `true` a cualquier
   * texto no vacio. Ver `common/transformaciones.ts`.
   */
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsOptional()
  @IsBoolean({
    message: 'incluir_inactivos debe ser true o false',
  })
  incluir_inactivos: boolean = false;
}

/** Respuesta de un listado paginado. */
export interface RespuestaPaginada<T> {
  datos: T[];
  total: number;
  pagina: number;
  por_pagina: number;
}

/**
 * Escapa los comodines de un `LIKE` para que se busquen como texto literal.
 *
 * Sin esto, buscar `%` traeria todos los registros y `RRHH_01` traeria tambien
 * `RRHHX01`, porque `_` es un comodin de un solo caracter.
 */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Busca un texto escapado en una columna, ignorando mayusculas y acentos. */
export function patronBusqueda(texto: string): string {
  return `%${escaparLike(texto.trim())}%`;
}
