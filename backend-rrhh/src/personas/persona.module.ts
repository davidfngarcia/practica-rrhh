import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { CommonModule } from '../common/common.module.js';
import { Empleado } from '../database/entities/empleado.entity.js';
import { Persona } from '../database/entities/persona.entity.js';
import { PersonasController } from './persona.controller.js';
import { PersonasService } from './persona.service.js';

@Module({
  // `Empleado` se registra tambien aqui porque `PersonasService` lo consulta para
  // impedir la baja de una persona que aun tiene empleados. `CommonModule` aporta el
  // cifrado del documento.
  imports: [
    TypeOrmModule.forFeature([Persona, Empleado]),
    AuditoriaModule,
    CommonModule,
  ],
  controllers: [PersonasController],
  providers: [PersonasService],
  exports: [PersonasService],
})
export class PersonasModule {}
