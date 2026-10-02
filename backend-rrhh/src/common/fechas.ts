import { ValidationOptions, registerDecorator } from 'class-validator';

/**
 * Validacion de fechas en formato `AAAA-MM-DD`.
 *
 * Las columnas de fecha se guardan como `date`, no como `datetime`: una fecha de
 * nacimiento o de ingreso no tiene hora, y guardar `2026-03-01 00:00:00` obliga a
 * compararla con conversiones de zona horaria que un dia acabaria en otro.
 *
 * El formato se fija en el contrato porque viaja en el JSON: si se aceptara
 * `01/03/2026` o `2026-3-1`, cada cliente interpretaria la ambiguedad de otra manera y
 * el dato almacenado dependeria de quien lo escribio.
 */

/** Forma que tienen las fechas en el contrato de la API. */
export const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Mensaje unico, para que el formato no se explique de dos maneras distintas. */
export const MENSAJE_FECHA =
  'La fecha debe estar en formato AAAA-MM-DD y ser una fecha real';

/**
 * Comprueba que el texto sea una fecha que existe.
 *
 * `Date.parse('2026-02-30')` no da error: normaliza a 2 de marzo. Se contrasta
 * round-trip con el dia, mes y anio leidos de vuelta, que es lo unico que detecta el
 * desbordamiento. Se construye la fecha con `Date.UTC` en vez de `new Date(texto)` para
 * que la zona horaria de la maquina no mueva el dia.
 */
export function esFecha(texto: unknown): boolean {
  if (typeof texto !== 'string' || !FORMATO_FECHA.test(texto)) return false;

  const [anio, mes, dia] = texto.split('-').map(Number);

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/** Indica si dos fechas en `AAAA-MM-DD` estan ordenadas. */
export function fechaAnteriorOIgual(primera: string, segunda: string): boolean {
  // El formato es de ancho fijo y cero a la izquierda, asi que el orden alfabetico
  // coincide con el cronologico: no hace falta convertir a `Date`.
  return primera <= segunda;
}

/**
 * Decorador que valida una fecha en formato `AAAA-MM-DD`.
 *
 * Se escribe a mano en vez de usar `@IsDateString()` porque su `isISO8601` acepta
 * `2026-02-30T10:00:00Z`: para una columna `date` sobraria la parte horaria, y el
 * mensaje seria el de `class-validator` en ingles.
 */
export function EsFecha(opciones?: ValidationOptions) {
  return function (objeto: object, propiedad: string): void {
    registerDecorator({
      name: 'esFecha',
      target: objeto.constructor,
      propertyName: propiedad,
      options: opciones,
      validator: {
        validate: esFecha,
        // El mensaje se escribe aqui y no con `buildMessage()` porque no hace falta
        // interpolar el nombre del campo: el filtro de errores ya lo antepone como
        // `campo` de cada motivo. `defaultMessage` espera una funcion, de ahi el
        // envoltorio; un `message` escrito como funcion se descarta, porque
        // interpretarla exigiria los argumentos de validacion que aqui no se usan.
        defaultMessage: () =>
          typeof opciones?.message === 'string'
            ? opciones.message
            : MENSAJE_FECHA,
      },
    });
  };
}
