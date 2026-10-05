import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Permiso } from '../database/entities/permiso.entity.js';
import { Rol } from '../database/entities/rol.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';
import { RolesController } from './rol.controller.js';
import { RolesService } from './rol.service.js';

/**
 * `UsuarioEmpresa` se registra porque el servicio cuenta las membresias activas de un rol
 * antes de desactivarlo o de darlo de baja. Es una comprobacion de integridad, no una
 * funcionalidad de membresias, y por eso no vive en el modulo de membresias: este
 * modulo no necesita nada de aquel.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Rol, Permiso, UsuarioEmpresa]),
    AuditoriaModule,
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
