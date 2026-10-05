/**
 * Sondas de salud.
 *
 * Son dos y la diferencia importa:
 *
 * - `/health` responde si el proceso vive. No mira nada mas, y por eso no necesita base de
 *   datos ni permisos: es la que consulta el orquestador para saber si debe reiniciar el
 *   contenedor.
 * - `/ready` comprueba que la base responde. Es la que decide si el proceso entra en
 *   rotacion. Si la base no esta, un `health` que responde 200 dejaria el contenedor
 *   recibiendo peticiones que van a fallar.
 *
 * Las dos quedan fuera del prefijo `/api/v1`: las sondas las consumen el orquestador, el
 * balanceador y el monitor, no el frontend. Meterlas bajo un prefijo de version obliga a
 * tocarlas el dia que se suba a v2, y un health check que cambia de ruta tumba el
 * despliegue entero.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { Public } from '../auth/guards.js';

/**
 * Terminus devuelve 503 solo si una de las comprobaciones falla, y ese es justo el
 * contrato que necesita un balanceador: mientras la base responda, 200; en cuanto deje de
 * hacerlo, fuera del pool de destinos.
 *
 * `pingCheck` usa la conexion que ya tiene abierta el `DataSource` de TypeORM, la misma
 * que sirve las peticiones, en vez de abrir una aparte. Si el pool esta agotado o la base
 * esta caida, ambas cosas se ven aqui; abrir una conexion nueva daria un falso "estoy
 * bien" justo en el momento en que importa mas.
 *
 * El limite de 2s evita que un `/ready` colgado bloquee un hilo durante el tiempo de espera
 * por defecto del pool.
 */
@Controller()
@ApiExcludeController()
@Public()
export class SaludController {
  constructor(
    private readonly salud: HealthCheckService,
    private readonly base: TypeOrmHealthIndicator,
  ) {}

  /**
   * El proceso vive. No dice nada de si puede atender peticiones.
   *
   * Va fuera del documento: no hay nada que documentar y sin esto Swagger anadiria un
   * grupo mas con una respuesta de texto plano, que es informacion de menos.
   */
  @Get('health')
  vivo(): { estado: string } {
    return { estado: 'ok' };
  }

  /**
   * El proceso vive y puede atender peticiones.
   *
   * Terminus gestiona el 503, asi que el metodo devuelve el resultado tal cual. Si la base
   * no responde contesta 503 con el detalle de la comprobacion que ha fallado, no 500.
   *
   * Tambien va fuera del documento, por el mismo motivo que `/health`: el documento es el
   * contrato con el frontend, y el frontend no consume esta ruta. Lo que el documento
   * tiene que hacer es describir de mas, no de menos.
   */
  @Get('ready')
  @HealthCheck()
  preparado(): Promise<HealthCheckResult> {
    // El `pingCheck` sin `connection` usa el `DataSource` global de Nest, que es el mismo
    // que sirve las peticiones. Abrir una conexion aparte daria un falso "estoy bien" justo
    // cuando el pool esta agotado o la base ha caido.
    return this.salud.check([
      () => this.base.pingCheck('base').withTimeout(2000),
    ]);
  }
}
