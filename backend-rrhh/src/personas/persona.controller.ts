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
  ActualizarPersonaDto,
  CrearPersonaDto,
  ListarPersonasDto,
} from './persona.dto.js';
import { PersonasService, type PersonaRespuesta } from './persona.service.js';

/**
 * Personas.
 *
 * El catalogo es global, asi que estas rutas no filtran por empresa: no hay
 * `empresa_id` en ninguna de ellas. Quien tenga `persona.leer` ve el catalogo completo,
 * que es lo que necesita el rol EMPLEADO para resolver su propia ficha.
 *
 * Aun asi todas las rutas exigen token y permiso: lo global no significa lo publico.
 */
@Controller('personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  @RequirePermissions('persona.leer')
  listar(
    @Query() filtros: ListarPersonasDto,
  ): Promise<RespuestaPaginada<PersonaRespuesta>> {
    return this.personas.listar(filtros);
  }

  @Get(':id')
  @RequirePermissions('persona.leer')
  obtener(@Param('id', UuidPipe) id: string): Promise<PersonaRespuesta> {
    return this.personas.obtener(id);
  }

  @Post()
  @RequirePermissions('persona.crear')
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearPersonaDto,
    @Req() request: Request,
  ): Promise<PersonaRespuesta> {
    return this.personas.crear(sesion, dto, contextoPeticion(request));
  }

  /**
   * `PATCH` y no `PUT`: solo se actualizan los campos que llegan en el cuerpo.
   *
   * Con `PUT` el cliente tendria que reenviar la persona completa para no perder lo que
   * omite, que es una fuente habitual de perdidas de datos accidentales.
   */
  @Patch(':id')
  @RequirePermissions('persona.actualizar')
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarPersonaDto,
    @Req() request: Request,
  ): Promise<PersonaRespuesta> {
    return this.personas.actualizar(sesion, id, dto, contextoPeticion(request));
  }

  /**
   * Baja logica, no borrado: la fila se conserva porque los empleados la referencian.
   *
   * Devuelve 409 si la persona tiene empleados, porque la fila no se puede dejar
   * huerfana. `204` sin cuerpo cuando si procede: no hay nada que describir, el recurso
   * ya no debe aparecer en los listados.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('persona.eliminar')
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.personas.eliminar(sesion, id, contextoPeticion(request));
  }
}
