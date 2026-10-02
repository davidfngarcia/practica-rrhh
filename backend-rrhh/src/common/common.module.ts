import { Module } from '@nestjs/common';
import { CifradoService } from './cifrado.service.js';

/**
 * Servicios transversales que no pertenecen a un dominio concreto.
 *
 * Existe por el mismo motivo que `AuditoriaModule`: `CifradoService` lo necesitan
 * `PersonasService` (documento), `EmpleadosService` (salario e IBAN) y, mas adelante,
 * `UsuariosService`. Declararlo en un modulo comun evita tener que registrarlo en cada
 * dominio que lo use, y evita el error opuesto, que es dar de alta una instancia distinta
 * por modulo: aqui es inocuo porque el servicio es sin estado, pero en cuanto guardara
 * una cache o un contador, dos instancias divergirian sin que nada lo indicara.
 */
@Module({
  providers: [CifradoService],
  exports: [CifradoService],
})
export class CommonModule {}
