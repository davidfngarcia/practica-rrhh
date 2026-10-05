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
  CONFLICTO_UNICO,
  DocumentarGrupo,
  Errores,
  nuevaRespuesta,
  RespuestaCreado,
  RespuestaLista,
  RespuestaOk,
  RespuestaSinCuerpo,
} from '../common/openapi.js';
import {
  PaginadoRolesDto,
  PermisoRespuestaDto,
  RolRespuestaDto,
} from '../common/respuesta.dto.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import {
  ActualizarRolDto,
  CrearRolDto,
  ListarRolesDto,
  PermisosRolDto,
} from './rol.dto.js';
import {
  RolesService,
  type PermisoRespuesta,
  type RolRespuesta,
} from './rol.service.js';

/** Rol de plantilla o en uso: son cosas distintas y hay que distinguirlas. */
const ROL_EN_USO = nuevaRespuesta(
  409,
  'El rol tiene membresias activas: hay que reasignar a esos usuarios antes de desactivarlo o de darle de baja.',
);

const ROL_DE_PLANTILLA = nuevaRespuesta(
  409,
  'El rol viene de la plantilla del sistema y no se puede renombrar ni dar de baja.',
);

/** Permiso por codigo que no existe en el catalogo. */
const PERMISO_DESCONOCIDO = nuevaRespuesta(
  400,
  'Uno de los permisos enviados no existe en el catalogo.',
);

/**
 * Roles y permisos de la empresa de la sesion.
 *
 * Los roles son de la empresa: no hay forma de pedir los de otra, porque el filtro es
 * `empresa_id = <empresa del token>` y no hay `empresa_id` en ninguna ruta.
 *
 * Los roles de plantilla no tienen empresa y no se exponen por aqui. Se copian a cada
 * empresa al crearla, y a partir de ahi son de esa empresa.
 */
@ApiTags('Roles')
@Controller('roles')
@DocumentarGrupo('Roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar los roles de la empresa activa.' })
  @ApiQuery({
    name: 'buscar',
    required: false,
    description: 'Busca en codigo y nombre.',
  })
  @ApiQuery({
    name: 'incluir_inactivos',
    required: false,
    description: 'Incluye los roles desactivados.',
  })
  @RequirePermissions('rol.leer')
  @Errores()
  @RespuestaOk('Listado paginado.', PaginadoRolesDto)
  listar(
    @CurrentUser() sesion: SesionActual,
    @Query() filtros: ListarRolesDto,
  ): Promise<RespuestaPaginada<RolRespuesta>> {
    return this.roles.listar(sesion, filtros);
  }

  /**
   * Catalogo de permisos.
   *
   * Vive en este controlador y no en uno aparte porque forma parte de la misma
   * pantalla: para conceder permisos hay que saber antes quais existen.
   */
  @Get('permisos')
  @ApiOperation({
    summary: 'Catalogo completo de permisos que se pueden conceder.',
  })
  @RequirePermissions('rol.leer')
  @Errores()
  @RespuestaLista('Permisos disponibles.', PermisoRespuestaDto)
  listarPermisos(): Promise<PermisoRespuesta[]> {
    return this.roles.listarPermisos();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un rol de la empresa activa.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('rol.leer')
  @Errores()
  @RespuestaOk('El rol solicitado.', RolRespuestaDto)
  obtener(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
  ): Promise<RolRespuesta> {
    return this.roles.obtener(sesion, id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Crear un rol en la empresa activa, con los permisos que se indiquen.',
  })
  @RequirePermissions('rol.crear')
  @Errores(CONFLICTO_UNICO, PERMISO_DESCONOCIDO)
  @RespuestaCreado('Rol creado.', RolRespuestaDto)
  crear(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: CrearRolDto,
    @Req() request: Request,
  ): Promise<RolRespuesta> {
    return this.roles.crear(sesion, dto, contextoPeticion(request));
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Actualizar un rol. Solo los campos enviados. El codigo no se puede cambiar.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('rol.actualizar')
  @Errores(ROL_EN_USO, ROL_DE_PLANTILLA)
  @RespuestaOk('El rol ya actualizado.', RolRespuestaDto)
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: ActualizarRolDto,
    @Req() request: Request,
  ): Promise<RolRespuesta> {
    return this.roles.actualizar(sesion, id, dto, contextoPeticion(request));
  }

  /**
   * Conjunto de permisos del rol.
   *
   * `PUT` y no `PATCH`: lo que llega es lo que se aplica. Es la unica forma de quitar un
   * permiso, ya que con semantica de parche solo se podrian anadir.
   */
  @Put(':id/permisos')
  @ApiOperation({
    summary: 'Sustituir el conjunto de permisos del rol por los que se envien.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('rol.actualizar')
  @Errores(PERMISO_DESCONOCIDO)
  @RespuestaOk('Permisos actualizados.', RolRespuestaDto)
  fijarPermisos(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Body() dto: PermisosRolDto,
    @Req() request: Request,
  ): Promise<RolRespuesta> {
    return this.roles.fijarPermisos(
      sesion,
      id,
      dto.permisos,
      contextoPeticion(request),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Dar de baja un rol. Es logico: la fila se conserva.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @RequirePermissions('rol.eliminar')
  @Errores(ROL_EN_USO, ROL_DE_PLANTILLA)
  @RespuestaSinCuerpo('Rol dado de baja.', 204)
  async eliminar(
    @CurrentUser() sesion: SesionActual,
    @Param('id', UuidPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.roles.eliminar(sesion, id, contextoPeticion(request));
  }
}
