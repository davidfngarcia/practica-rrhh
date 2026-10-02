import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Puesto } from '../database/entities/puesto.entity.js';
import { PuestosController } from './puesto.controller.js';
import { PuestosService } from './puesto.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Puesto]), AuditoriaModule],
  controllers: [PuestosController],
  providers: [PuestosService],
  exports: [PuestosService],
})
export class PuestosModule {}
