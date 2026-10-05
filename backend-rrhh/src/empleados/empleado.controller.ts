import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/guards.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { contextoPeticion, CurrentUser } from '../auth/sesion.decorator.js';
import {
  CONFLICTO_UNICO,
  CONFLICTO_VERSION,
  DocumentarGrupo,
  Errores,
  RespuestaCreado,
  RespuestaOk,
  RespuestaSinCuerpo,
} from '../common/openapi.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import {
  EmpleadoRespuestaDto,
  PaginadoEmpleadosDto,
} from '../common/respuesta.dto.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import {
  ActualizarEmpleadoDto,
  CrearEmpleadoDto,
  ListarEmpleadosDto,
} from './empleado.dto.js';
import {
  EmpleadosService,
  type EmpleadoRespuesta,
} from './empleado.service.js';

/**
 * Empleados de la empresa de la sesion.
 *
 * No hay ningun `empresa_id` en ninguna ruta ni en ningun cuerpo: la empresa sale del
 * token. Si el cliente pudiera elegirla, bastaria cambiar un parametro para leer la
 * nomina de otra empresa.
 */
@Controller('empleados')
@DocumentarGrupo('Empleados')
export class EmpleadosController {
  constructor(private readonly empleados: EmpleadosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar empleados de la empresa activa.' })
  @ApiQuery({
    name: 'buscar',
    required: false,
    description: 'Busca por codigo de empleado.',
  })
  @ApiQuery({ name: 'departamento_id', required: false, format: 'uuid' })
  @ApiQuery({ name: 'puesto_id', required: false, format: 'uuid' })
  @ApiQuery({
    name: 'activo',
    required: false,
    description: 'Filtra por vigencia.',
  })
  @RequirePermissions('empleado.leer')
  @Errores()
  @RespuestaOk('Listado paginado.', PaginadoEmpleadosDto)
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarEmpleadosDto,
  ): Promise<RespuestaPaginada<EmpleadoRespuesta>> {
    return this.empleados.listar(sesion, filtros);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Ver un empleado. `salario` e `iban` solo aparecen con `empleado.sensible.leer`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('empleado.leer')
  @Errores()
  @RespuestaOk('El empleado solicitado.', EmpleadoRespuestaDto)
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<EmpleadoRespuesta> {
    return this.empleados.obtener(sesion, id);
  }

  /**
   * Alta de un empleado.
   *
   * Comprueba que la persona exista y no este dada de baja, y que el departamento y el
   * puesto, si vienen, sean de esta misma empresa. Esos errores llegan como 400 con un
   * mensaje en castellano, y no como el error de FK de MySQL.
   */
  @Post()
  @ApiOperation({ summary: 'Contratar a una persona en la empresa activa.' })
  @RequirePermissions('empleado.crear')
  @Errores(CONFLICTO_UNICO)
  @RespuestaCreado('Contratacion creada.', EmpleadoRespuestaDto)
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearEmpleadoDto,
    @Req() request: Request,
  ): Promise<EmpleadoRespuesta> {
    return this.empleados.crear(sesion, dto, contextoPeticion(request));
  }

  /**
   * `PATCH` y no `PUT`: solo se actualizan los campos que llegan en el cuerpo.
   *
   * Un `null` explicito en `departamento_id`, `puesto_id` o `fecha_fin` si significa algo:
   * deja el campo vacio.
   */
  @Patch(':id')
  @ApiOperation({
    summary:
      'Actualizar una contratacion. Solo los campos enviados. `version` detecta ' +
      'ediciones simultaneas.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('empleado.actualizar')
  @Errores(CONFLICTO_UNICO, CONFLICTO_VERSION)
  @RespuestaOk('La contratacion ya actualizada.', EmpleadoRespuestaDto)
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarEmpleadoDto,
    @Req() request: Request,
  ): Promise<EmpleadoRespuesta> {
    return this.empleados.actualizar(
      sesion,
      id,
      dto,
      contextoPeticion(request),
    );
  }

  /**
   * Baja logica, no borrado: la fila se conserva porque es historico laboral.
   *
   * `204` sin cuerpo porque no hay nada que describir: el recurso ya no debe aparecer en
   * los listados.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Dar de baja una contratacion. Es logico: el historico se conserva.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('empleado.eliminar')
  @Errores()
  @RespuestaSinCuerpo('Contratacion dada de baja.', 204)
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.empleados.eliminar(sesion, id, contextoPeticion(request));
  }
}
