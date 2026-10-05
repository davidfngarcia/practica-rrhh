/**
 * URL base de la API.
 *
 * En un solo sitio, y no repartido en cada llamada, porque cambiar el prefijo de version
 * obligaria entonces a tocar todos los servicios. Con `/api/v1` aqui, subir a v2 es
 * cambiar esta constante.
 *
 * El valor viene del build (`environment.ts`), no de una constante en el codigo: los
 * contenedores de desarrollo y de produccion apuntan a host distintos y no deben
 * compilarse distinto para eso.
 */
export const API_BASE = '/api/v1';
