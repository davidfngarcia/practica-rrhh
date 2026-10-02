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
import type { Request } from 'express';
import { CurrentUser, contextoPeticion } from '../auth/sesion.decorator.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { RequirePermissions } from '../auth/guards.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
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
export class PuestosController {
  constructor(private readonly puestos: PuestosService) {}

  @Get()
  @RequirePermissions('puesto.leer')
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarPuestosDto,
  ): Promise<RespuestaPaginada<PuestoRespuesta>> {
    return this.puestos.listar(sesion, filtros);
  }

  @Get(':id')
  @RequirePermissions('puesto.leer')
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<PuestoRespuesta> {
    return this.puestos.obtener(sesion, id);
  }

  @Post()
  @RequirePermissions('puesto.crear')
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
  @RequirePermissions('puesto.actualizar')
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
  @RequirePermissions('puesto.eliminar')
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.puestos.eliminar(sesion, id, contextoPeticion(request));
  }
}
