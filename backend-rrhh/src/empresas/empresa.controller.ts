import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/guards.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { contextoPeticion, CurrentUser } from '../auth/sesion.decorator.js';
import { DocumentarGrupo, Errores, RespuestaOk } from '../common/openapi.js';
import { EmpresaRespuestaDto } from '../common/respuesta.dto.js';
import { ActualizarEmpresaDto } from './empresa.dto.js';
import { EmpresasService } from './empresa.service.js';

/**
 * Datos de la empresa de la sesion.
 *
 * **Ninguna ruta acepta un identificador.** La empresa sale del token y no hay ningun
 * sitio donde el cliente pueda indicar otra: anadir un `:id` aqui devolveria los datos
 * de cualquier empresa que se supiera su UUID, que es exactamente lo que el resto de la
 * API evita.
 *
 * Tampoco hay listado ni alta. El razon esta en `empresa.service.ts`, pero la version
 * corta es que la empresa es la raiz del multi-tenant y una API de tenant no puede
 * listar tenants ni crear tenants.
 */
@Controller('empresa')
@DocumentarGrupo('Empresa')
export class EmpresasController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get()
  @ApiOperation({
    summary: 'Datos de la empresa de la sesion. No acepta identificador.',
  })
  @RequirePermissions('empresa.leer')
  @Errores()
  @RespuestaOk('La empresa de la sesion.', EmpresaRespuestaDto)
  obtener(@CurrentUser('empresa_id') empresaId: string) {
    return this.empresas.obtener(empresaId);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Actualizar los datos de la empresa propia. Solo los campos enviados. El codigo, ' +
      'la identificacion tributaria y el estado no se pueden cambiar por aqui.',
  })
  @RequirePermissions('empresa.actualizar')
  @Errores()
  @RespuestaOk('La empresa ya actualizada.', EmpresaRespuestaDto)
  actualizar(
    @CurrentUser() sesion: SesionActual,
    @Body() dto: ActualizarEmpresaDto,
    @Req() request: Request,
  ) {
    return this.empresas.actualizar(
      sesion.empresa_id,
      sesion.sub,
      dto,
      contextoPeticion(request),
    );
  }
}
