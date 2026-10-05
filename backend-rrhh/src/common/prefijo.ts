/**
 * Prefijo de version de la API.
 *
 * Vive aqui, y no en `main.ts`, porque lo necesitan dos consumidores distintos: la app real
 * y la que montan las pruebas E2E. Si cada una escribiera el prefijo por su cuenta, las
 * pruebas seguirian dando verde contra rutas que ya no existen, que es la forma mas
 * silenciosa de perder la version.
 *
 * Sin prefijo, cambiar de contrato obliga a romper a todos los clientes a la vez. Con el,
 * `/api/v1` y `/api/v2` pueden convivir mientras los clientes migran.
 */
import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/** Prefijo de version de la API. */
export const PREFIJO_API = 'api/v1';

/**
 * Rutas que quedan fuera del prefijo.
 *
 * Son las sondas de salud, y las consumen el orquestador y el balanceador, no el frontend.
 * No pueden depender de la version: un health check que cambia de ruta al subir de v2 tumba
 * el despliegue entero, y es el fallo mas caro posible porque ocurre sin avisar y
 * provoca que el orquestador reinicie un contenedor sano.
 */
const SONDAS = [
  { path: 'health', method: RequestMethod.GET },
  { path: 'ready', method: RequestMethod.GET },
];

/** Rutas que no llevan version, con la barra inicial. */
export const RUTAS_SIN_VERSION = ['/health', '/ready'];

/** Registra el prefijo global. Lo usan `main.ts` y el arranque de las pruebas. */
export function configurarPrefijo(app: INestApplication): void {
  app.setGlobalPrefix(PREFIJO_API, { exclude: SONDAS });
}

/**
 * Anade el prefijo a una ruta.
 *
 * Es la forma que usan las pruebas para pedir `/personas` y recibir `/api/v1/personas`: si
 * el prefijo estuviera escrito en cada llamada, subir de version seria cambiar 130
 * lineas de las suites, y el fallo mas probable seria que se escapara alguna sin que
 * ninguna prueba lo delatara.
 */
export function rutaApi(ruta: string): string {
  return RUTAS_SIN_VERSION.includes(ruta) ? ruta : `/${PREFIJO_API}${ruta}`;
}
