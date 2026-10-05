import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { Empresa } from '../database/entities/empresa.entity.js';
import { EmpresasController } from './empresa.controller.js';
import { EmpresasService } from './empresa.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa]), AuditoriaModule],
  controllers: [EmpresasController],
  providers: [EmpresasService],
})
export class EmpresasModule {}
