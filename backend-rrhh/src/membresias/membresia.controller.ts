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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/guards.js';
import { CurrentUser, contextoPeticion } from '../auth/sesion.decorator.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import {
  DocumentarGrupo,
  Errores,
  nuevaRespuesta,
  RespuestaCreado,
  RespuestaLista,
  RespuestaOk,
  RespuestaSinCuerpo,
} from '../common/openapi.js';
import {
  MembresiaRespuestaDto,
  PaginadoMembresiasDto,
} from '../common/respuesta.dto.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import {
  ActualizarMembresiaDto,
  CambiarRolesDto,
  CrearMembresiaDto,
  ListarMembresiasDto,
} from './membresia.dto.js';
import {
  MembresiasService,
  type MembresiaRespuesta,
} from './membresia.service.js';

/** Un rol que no es de esta empresa, o que no existe. */
const ROL_AJENO = nuevaRespuesta(
  404,
  'El rol no existe en esta empresa. No se admiten roles de otra empresa ni de plantilla.',
);

/** Dar de alta a alguien que ya es miembro. */
const YA_ES_MIEMBRO = nuevaRespuesta(
  409,
  'El usuario ya es miembro de esta empresa.',
);

/**
 * Tocarse a uno mismo el rol propio.
 *
 * No es un capricho del servicio: el guard relee los permisos de la base en cada
 * peticion, asi que cambiarse el rol a uno mismo deja la sesion viva pero sin nada que
 * pueda hacer, y desactivar la propia membresia la deja sin empresa.
 */
const NO_TOCARSE = nuevaRespuesta(
  409,
  'No se puede cambiar ni desactivar la membresia propia.',
);

/** Dejar a la empresa sin nadie que pueda administrar sus roles. */
const ULTIMO_ADMIN = nuevaRespuesta(
  409,
  'Es el unico administrador activo de la empresa: da de alta a otro antes de quitar este.',
);

/**
 * Miembros de la empresa de la sesion.
 *
 * El usuario es global y la membresia es lo que lo hace miembro de un tenant. Por eso
 * estas rutas solo mueven la relacion: el `usuario_id` de una membresia no se puede
 * cambiar, y el rol tiene que ser siempre de la empresa de la sesion.
 */
@ApiTags('Membresias')
@Controller('membresias')
@DocumentarGrupo('Membresias')
export class MembresiasController {
  constructor(private readonly membresias: MembresiasService) {}

  @Get()
  @ApiOperation({ summary: 'Listar los miembros de la empresa activa.' })
  @ApiQuery({
    name: 'buscar',
    required: false,
    description: 'Busca en el nombre de usuario y en el correo.',
  })
  @ApiQuery({
    name: 'incluir_inactivos',
    required: false,
    description: 'Incluye las membresias desactivadas.',
  })
  @RequirePermissions('usuario.leer')
  @Errores()
  @RespuestaOk('Listado paginado.', PaginadoMembresiasDto)
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarMembresiasDto,
  ): Promise<RespuestaPaginada<MembresiaRespuesta>> {
    return this.membresias.listar(sesion, filtros);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver una membresia de la empresa activa.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('usuario.leer')
  @Errores()
  @RespuestaOk('La membresia solicitada.', MembresiaRespuestaDto)
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<MembresiaRespuesta> {
    return this.membresias.obtener(sesion, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Dar de alta a un usuario en la empresa activa con un rol.',
  })
  @RequirePermissions('usuario.crear')
  @Errores(ROL_AJENO, YA_ES_MIEMBRO, NO_TOCARSE)
  @RespuestaCreado('Membresia creada.', MembresiaRespuestaDto)
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearMembresiaDto,
    @Req() request: Request,
  ): Promise<MembresiaRespuesta> {
    return this.membresias.crear(sesion, dto, contextoPeticion(request));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Cambiar el rol o el estado de una membresia.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('usuario.actualizar')
  @Errores(ROL_AJENO, NO_TOCARSE, ULTIMO_ADMIN)
  @RespuestaOk('La membresia ya actualizada.', MembresiaRespuestaDto)
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarMembresiaDto,
    @Req() request: Request,
  ): Promise<MembresiaRespuesta> {
    return this.membresias.actualizar(
      sesion,
      id,
      dto,
      contextoPeticion(request),
    );
  }

  /**
   * Reasignacion en bloque.
   *
   * `PUT` porque es una sustitucion: el conjunto de ids que llega es el que se reasigna, y
   * repetir la peticion con los mismos ids no deja a nadie a medias.
   */
  @Put('roles')
  @ApiOperation({
    summary: 'Pasar varias membresias a un mismo rol, de una vez.',
  })
  @RequirePermissions('usuario.actualizar')
  @Errores(ROL_AJENO, NO_TOCARSE)
  @RespuestaLista('Membresias ya reasignadas.', MembresiaRespuestaDto)
  cambiarRoles(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CambiarRolesDto,
    @Req() request: Request,
  ): Promise<MembresiaRespuesta[]> {
    return this.membresias.cambiarRoles(sesion, dto, contextoPeticion(request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Dar de baja a un miembro. El usuario sigue existiendo.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('usuario.eliminar')
  @Errores(NO_TOCARSE, ULTIMO_ADMIN)
  @RespuestaSinCuerpo('Membresia dada de baja.', 204)
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.membresias.eliminar(sesion, id, contextoPeticion(request));
  }
}
