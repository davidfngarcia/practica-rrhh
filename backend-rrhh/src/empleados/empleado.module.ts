import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { CommonModule } from '../common/common.module.js';
import { Departamento } from '../database/entities/departamento.entity.js';
import { Empleado } from '../database/entities/empleado.entity.js';
import { Persona } from '../database/entities/persona.entity.js';
import { Puesto } from '../database/entities/puesto.entity.js';
import { EmpleadosController } from './empleado.controller.js';
import { EmpleadosService } from './empleado.service.js';

@Module({
  // Se registran las cuatro entidades porque `EmpleadosService` valida las referencias
  // antes de escribir: la persona tiene que existir y el departamento y el puesto tienen
  // que ser de la misma empresa que el empleado. `CommonModule` aporta el cifrado del
  // salario y del IBAN.
  imports: [
    TypeOrmModule.forFeature([Empleado, Persona, Departamento, Puesto]),
    AuditoriaModule,
    CommonModule,
  ],
  controllers: [EmpleadosController],
  providers: [EmpleadosService],
  exports: [EmpleadosService],
})
export class EmpleadosModule {}
