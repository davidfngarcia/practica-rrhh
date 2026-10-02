import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Auditoria } from '../database/entities/auditoria.entity.js';
import { AuditoriaService } from './auditoria.service.js';

/**
 * Modulo de auditoria.
 *
 * Se exporta para que lo importen los modulos que registran acciones, y no al
 * reves: la escritura de auditoria no debe arrastrar el resto del `AuthModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Auditoria])],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
