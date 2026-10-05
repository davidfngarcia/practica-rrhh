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
import { CurrentUser, contextoPeticion } from '../auth/sesion.decorator.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { RequirePermissions } from '../auth/guards.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import {
  CONFLICTO_UNICO,
  DocumentarGrupo,
  Errores,
  RespuestaCreado,
  RespuestaOk,
  RespuestaSinCuerpo,
} from '../common/openapi.js';
import {
  PuestoRespuestaDto,
  PaginadoPuestosDto,
} from '../common/respuesta.dto.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import {
  ActualizarPuestoDto,
  CrearPuestoDto,
  ListarPuestosDto,
} from './puesto.dto.js';
import { PuestosService, type PuestoRespuesta } from './puesto.service.js';

/**
 * Puestos de la empresa de la sesion.
 *
 * No hay ningun `empresa_id` en ninguna ruta ni en ningun cuerpo: la empresa sale
 * del token. Si el cliente pudiera elegirla, bastaria cambiar un parametro para
 * leer los datos de otra empresa.
 */
@Controller('puestos')
@DocumentarGrupo('Puestos')
export class PuestosController {
  constructor(private readonly puestos: PuestosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar puestos de la empresa activa.' })
  @ApiQuery({
    name: 'buscar',
    required: false,
    description: 'Busca en codigo y nombre.',
  })
  @ApiQuery({
    name: 'incluir_inactivos',
    required: false,
    description: 'Incluye los dados de baja logica.',
  })
  @RequirePermissions('puesto.leer')
  @Errores()
  @RespuestaOk('Listado paginado.', PaginadoPuestosDto)
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarPuestosDto,
  ): Promise<RespuestaPaginada<PuestoRespuesta>> {
    return this.puestos.listar(sesion, filtros);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un puesto de la empresa activa.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('puesto.leer')
  @Errores()
  @RespuestaOk('El puesto solicitado.', PuestoRespuestaDto)
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<PuestoRespuesta> {
    return this.puestos.obtener(sesion, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un puesto en la empresa activa.' })
  @RequirePermissions('puesto.crear')
  @Errores(CONFLICTO_UNICO)
  @RespuestaCreado('Puesto creado.', PuestoRespuestaDto)
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearPuestoDto,
    @Req() request: Request,
  ): Promise<PuestoRespuesta> {
    return this.puestos.crear(sesion, dto, contextoPeticion(request));
  }

  /**
   * `PATCH` y no `PUT`: solo se actualizan los campos que llegan en el cuerpo.
   *
   * Con `PUT` el cliente tendria que reenviar el registro completo para no borrar
   * lo que omite, que es una fuente habitual de perdidas de datos accidentales.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un puesto. Solo los campos enviados.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('puesto.actualizar')
  @Errores(CONFLICTO_UNICO)
  @RespuestaOk('El puesto ya actualizado.', PuestoRespuestaDto)
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarPuestoDto,
    @Req() request: Request,
  ): Promise<PuestoRespuesta> {
    return this.puestos.actualizar(sesion, id, dto, contextoPeticion(request));
  }

  /**
   * Baja logica, no borrado: la fila se conserva porque los empleados la referencian.
   *
   * `204` sin cuerpo porque no hay nada que describir: el recurso ya no debe
   * aparecer en los listados.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Dar de baja un puesto. Es logico: la fila se conserva.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('puesto.eliminar')
  @Errores()
  @RespuestaSinCuerpo('Puesto dado de baja.', 204)
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.puestos.eliminar(sesion, id, contextoPeticion(request));
  }
}
