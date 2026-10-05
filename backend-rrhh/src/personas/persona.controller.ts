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
  DocumentarGrupo,
  Errores,
  RespuestaCreado,
  RespuestaOk,
  RespuestaSinCuerpo,
  nuevaRespuesta,
} from '../common/openapi.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import {
  PersonaRespuestaDto,
  PaginadoPersonasDto,
} from '../common/respuesta.dto.js';
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
@DocumentarGrupo('Personas')
export class PersonasController {
  constructor(private readonly personas: PersonasService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar el catalogo global de personas. No filtra por empresa.',
  })
  @ApiQuery({
    name: 'buscar',
    required: false,
    description: 'Busca por nombre o documento.',
  })
  @ApiQuery({
    name: 'activo',
    required: false,
    description: 'Filtra por vigencia.',
  })
  @RequirePermissions('persona.leer')
  @Errores()
  @RespuestaOk('Listado paginado.', PaginadoPersonasDto)
  listar(
    @Query() filtros: ListarPersonasDto,
  ): Promise<RespuestaPaginada<PersonaRespuesta>> {
    return this.personas.listar(filtros);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver una persona del catalogo global.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('persona.leer')
  @Errores()
  @RespuestaOk('La persona solicitada.', PersonaRespuestaDto)
  obtener(@Param('id', UuidPipe) id: string): Promise<PersonaRespuesta> {
    return this.personas.obtener(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Alta de una persona en el catalogo global. No es una contratacion: para ' +
      'contratar hay que dar de alta el empleado.',
  })
  @RequirePermissions('persona.crear')
  @Errores(CONFLICTO_UNICO)
  @RespuestaCreado('Persona creada.', PersonaRespuestaDto)
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
  @ApiOperation({
    summary: 'Actualizar una persona. Solo los campos enviados.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('persona.actualizar')
  @Errores(CONFLICTO_UNICO)
  @RespuestaOk('La persona ya actualizada.', PersonaRespuestaDto)
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
  @ApiOperation({
    summary:
      'Dar de baja una persona. Da 409 si tiene empleados: la fila no puede quedar ' +
      'referenciada.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('persona.eliminar')
  @Errores(
    nuevaRespuesta(
      409,
      'La persona tiene empleados dados de alta y no se puede dar de baja.',
    ),
  )
  @RespuestaSinCuerpo('Persona dada de baja.', 204)
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.personas.eliminar(sesion, id, contextoPeticion(request));
  }
}
