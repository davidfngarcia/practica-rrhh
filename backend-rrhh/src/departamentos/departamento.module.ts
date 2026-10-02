import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Departamento } from '../database/entities/departamento.entity.js';
import { DepartamentosController } from './departamento.controller.js';
import { DepartamentosService } from './departamento.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Departamento]), AuditoriaModule],
  controllers: [DepartamentosController],
  providers: [DepartamentosService],
  exports: [DepartamentosService],
})
export class DepartamentosModule {}
