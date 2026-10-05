import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Rol } from '../database/entities/rol.entity.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';
import { MembresiasController } from './membresia.controller.js';
import { MembresiasService } from './membresia.service.js';

/**
 * `Usuario` y `Rol` se registran porque el servicio necesita leerlos: el usuario para
 * comprobar que existe y esta activo, y el rol para verificar que es de esta empresa.
 *
 * `Rol` viene ya registrado en `RolesModule`, pero `forFeature` es por modulo y no se
 * comparte: declararlo aqui es lo unico que hace que `getRepositoryToken(Rol)` resuelva
 * dentro de este modulo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([UsuarioEmpresa, Usuario, Rol]),
    AuditoriaModule,
  ],
  controllers: [MembresiasController],
  providers: [MembresiasService],
  exports: [MembresiasService],
})
export class MembresiasModule {}
