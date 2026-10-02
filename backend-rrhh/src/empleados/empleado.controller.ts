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
import { RequirePermissions } from '../auth/guards.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { contextoPeticion, CurrentUser } from '../auth/sesion.decorator.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
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
export class EmpleadosController {
  constructor(private readonly empleados: EmpleadosService) {}

  @Get()
  @RequirePermissions('empleado.leer')
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarEmpleadosDto,
  ): Promise<RespuestaPaginada<EmpleadoRespuesta>> {
    return this.empleados.listar(sesion, filtros);
  }

  @Get(':id')
  @RequirePermissions('empleado.leer')
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
  @RequirePermissions('empleado.crear')
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
  @RequirePermissions('empleado.actualizar')
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
  @RequirePermissions('empleado.eliminar')
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.empleados.eliminar(sesion, id, contextoPeticion(request));
  }
}
