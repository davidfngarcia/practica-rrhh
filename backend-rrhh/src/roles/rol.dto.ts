import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
 * Formato admitido en `codigo`, el mismo que en puestos y departamentos.
 *
 * Mayusculas permitidas a proposito: los roles de la plantilla estan en mayusculas
 * (`ADMIN_EMPRESA`, `RRHH`) y un cliente no deberia tener que aprender dos reglas.
 */
const FORMATO_CODIGO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Longitudes tomadas de `rol.entity.ts`. */
const MAX_CODIGO = 50;
const MAX_NOMBRE = 100;
const MAX_DESCRIPCION = 255;

/**
 * Tope de permisos por peticion.
 *
 * El catalogo tiene 30, asi que 100 no limita a nadie hoy; existe para que un
 * `permisos: []` con cien mil elementos no se convierta en un INSERT gigante.
 *
 * Los repetidos no se rechazan, se ignoran: `resolverPermisos` los pasa por un `Set`, y
 * eso tambien lo hace bien con las variantes de mayusculas (`puesto.leer` y
 * `PUESTO.LEER` son el mismo permiso). Un `@ArrayUnique` seria mas estricto pero
 * distinguira mayusculas, dejaria pasar justo el duplicado que duele y rechazaria una
 * peticion que en realidad es correcta.
 */
const MAX_PERMISOS = 100;

/**
 * Listado de roles.
 *
 * No declara nada: `PaginadoDto` ya aporta pagina, por_pagina, `buscar` e
 * `incluir_inactivos`, que es exactamente lo que este listado necesita. Redeclararlos
 * aqui seria duplicar validaciones que luego divergen.
 */
export class ListarRolesDto extends PaginadoDto {}

/** Alta de un rol. */
export class CrearRolDto {
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

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;

  /**
   * Permisos a conceder en el alta, por codigo.
   *
   * Van por codigo y no por id a proposito: el codigo es lo que conoce el administrador
   * que esta configurando la empresa, y el id es un UUID que no aparece en ningun sitio.
   * Un codigo desconocido se rechaza con 400 nombrandolo, no se ignora en silencio.
   */ @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PERMISOS, {
    message: `No se pueden conceder mas de ${MAX_PERMISOS} permisos de una vez`,
  })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  permisos?: string[];
}

/**
 * Modificacion de un rol.
 *
 * `codigo` NO se puede cambiar. Un rol con historial ya asignado tiene ese codigo
 * escrito en logs, en auditoria y en lo que el usuario ve al cambiar de empresa; darle
 * otro valor deja los registros antiguos hablando de un rol que ya no existe. Para
 * renombrarlo hay que darlo de baja y crear otro.
 *
 * `es_sistema` tampoco: es la marca de "viene de la plantilla", y un endpoint que la
 * pudiera limpiar dejaria al tenant con roles de sistema que se pueden desconfigurar
 * hasta dejarlo sin nadie con permisos.
 */
export class ActualizarRolDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NOMBRE)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DESCRIPCION)
  descripcion?: string;

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;
}

/**
 * Conjunto completo de permisos de un rol.
 *
 * Se declara aparte del PATCH porque sustituir el conjunto y modificar campos son cosas
 * distintas: aqui no hay nada que interpretar, lo que llega es lo que se aplica.
 */
export class PermisosRolDto {
  @IsArray()
  @ArrayMaxSize(MAX_PERMISOS, {
    message: `No se pueden conceder mas de ${MAX_PERMISOS} permisos de una vez`,
  })
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  permisos: string[];
}
