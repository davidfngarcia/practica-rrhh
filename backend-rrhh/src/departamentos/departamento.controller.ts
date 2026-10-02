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
import { UuidPipe } from '../common/uuid.pipe.js';
import {
  ActualizarDepartamentoDto,
  CrearDepartamentoDto,
  ListarDepartamentosDto,
} from './departamento.dto.js';
import {
  DepartamentosService,
  type DepartamentoRespuesta,
} from './departamento.service.js';
import type { RespuestaPaginada } from '../common/paginacion.js';

/**
 * Departamentos de la empresa de la sesion.
 *
 * No hay ningun `empresa_id` en ninguna ruta ni en ningun cuerpo: la empresa sale
 * del token. Si el cliente pudiera elegirla, bastaria cambiar un parametro para
 * leer los datos de otra empresa.
 */
@Controller('departamentos')
export class DepartamentosController {
  constructor(private readonly departamentos: DepartamentosService) {}

  @Get()
  @RequirePermissions('departamento.leer')
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarDepartamentosDto,
  ): Promise<RespuestaPaginada<DepartamentoRespuesta>> {
    return this.departamentos.listar(sesion, filtros);
  }

  @Get(':id')
  @RequirePermissions('departamento.leer')
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<DepartamentoRespuesta> {
    return this.departamentos.obtener(sesion, id);
  }

  @Post()
  @RequirePermissions('departamento.crear')
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearDepartamentoDto,
    @Req() request: Request,
  ): Promise<DepartamentoRespuesta> {
    return this.departamentos.crear(sesion, dto, contextoPeticion(request));
  }

  /**
   * `PATCH` y no `PUT`: solo se actualizan los campos que llegan en el cuerpo.
   *
   * Con `PUT` el cliente tendria que reenviar el registro completo para no borrar
   * lo que omite, que es una fuente habitual de perdidas de datos accidentales.
   */
  @Patch(':id')
  @RequirePermissions('departamento.actualizar')
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarDepartamentoDto,
    @Req() request: Request,
  ): Promise<DepartamentoRespuesta> {
    return this.departamentos.actualizar(
      sesion,
      id,
      dto,
      contextoPeticion(request),
    );
  }

  /**
   * Baja logica, no borrado: la fila se conserva porque los empleados la referencian.
   *
   * `204` sin cuerpo porque no hay nada que describir: el recurso ya no debe
   * aparecer en los listados.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('departamento.eliminar')
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.departamentos.eliminar(sesion, id, contextoPeticion(request));
  }
}
