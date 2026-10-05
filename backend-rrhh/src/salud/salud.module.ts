import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { SaludController } from './salud.controller.js';

/**
 * Terminus va en su propio modulo para que `TypeOrmHealthIndicator` reciba el `DataSource`
 * por la instancia global de TypeORM, y no por el repositorio de un modulo concreto.
 */
@Module({
  imports: [TerminusModule],
  controllers: [SaludController],
})
export class SaludModule {}
