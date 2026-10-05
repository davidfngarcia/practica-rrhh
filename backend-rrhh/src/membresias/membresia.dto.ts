import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { PaginadoDto } from '../common/paginacion.js';
import { aBooleano } from '../common/transformaciones.js';

/**
 * Listado de los miembros de la empresa de la sesion.
 *
 * No declara nada: `PaginadoDto` ya aporta pagina, por_pagina, `buscar` e
 * `incluir_inactivos`, que es exactamente lo que este listado necesita. Redeclararlos
 * aqui seria duplicar validaciones que luego divergen.
 */
export class ListarMembresiasDto extends PaginadoDto {}

/**
 * Alta de un miembro en la empresa de la sesion.
 *
 * El `usuario_id` es obligatorio y tiene que existir ya. Dar de alta a una persona y
 * comprometerla con una empresa son dos hechos distintos: la persona existe en el sistema
 * aunque no trabaje aqui, y por eso su alta es una operacion global, no de este tenant.
 * Invitar a alguien que aun no tiene cuenta es otra funcion, con su ciclo de vida y su
 * caducidad, y no cabe en el `POST` de una membresia.
 */
export class CrearMembresiaDto {
  @IsUUID('4', { message: 'usuario_id debe ser un UUID' })
  usuario_id: string;

  @IsUUID('4', { message: 'rol_id debe ser un UUID' })
  rol_id: string;

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;
}

/**
 * Modificacion de una membresia.
 *
 * `usuario_id` y `empresa_id` NO se pueden cambiar: la membresia ES la relacion entre un
 * usuario y esta empresa, y moverla de sitio seria crear otra relacion distinta. Para
 * cambiar de persona o de empresa hay que dar de baja esta y dar de alta la nueva.
 */
export class ActualizarMembresiaDto {
  @IsOptional()
  @IsUUID('4', { message: 'rol_id debe ser un UUID' })
  rol_id?: string;

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== undefined)
  @Transform(({ obj, key }) => aBooleano(obj?.[key]))
  @IsBoolean({ message: 'activo debe ser true o false' })
  activo?: boolean;
}

/**
 * Reasignacion de rol en bloque.
 *
 * Va declarada aparte del `PATCH` porque cambiar el rol de treinta personas de una vez es
 * otra operacion que tocar treinta membresias una a una, y por eso merece su propia
 * auditoria: un unico evento que dice "estas treinta personas han pasado de un rol a
 * otro", en lugar de treinta eventos que hay que reconstruir despues para entenderlo.
 *
 * Se declara con tope y sin paginacion a proposito. Es una accion de administracion, no
 * un listado, y un `IN (?)` de varios cientos de ids es asumible; lo que no se admite es
 * un cuerpo sin limite, que es justo lo que el `ArrayMaxSize` impide.
 */
export class CambiarRolesDto {
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Indica al menos una membresia a reasignar',
  })
  @ArrayMaxSize(500, {
    message: 'No se pueden reasignar mas de 500 membresias de una vez',
  })
  @IsUUID('4', {
    each: true,
    message: 'membresia_ids debe ser una lista de UUID',
  })
  membresia_ids: string[];

  @IsUUID('4', { message: 'rol_id debe ser un UUID' })
  rol_id: string;
}
