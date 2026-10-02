/**
 * Lectura del cuerpo de las peticiones.
 *
 * Nest registra sus propios middlewares de `body-parser`, y cuando el JSON llega
 * mal formado su adaptador convierte el error de parseo en un
 * `BadRequestException` cuyo mensaje es el de `JSON.parse` en ingles
 * ("Unexpected end of JSON input"). Ese texto no distingue nada util para quien
 * consume la API.
 *
 * Por eso se registra el parser aqui, con `bodyParser: false` en
 * `NestFactory.create`: el error de parseo se responde en castellano y con el
 * mismo formato que el resto de errores.
 */
import { INestApplication } from '@nestjs/common';
import { json, Request, Response } from 'express';

/**
 * Tamano maximo del cuerpo.
 *
 * Es el mismo limite que aplica `body-parser` por defecto, que es el que se
 * tendria con el parser de Nest. La API solo recibe JSON y los cuerpos no
 * superan unos pocos kilobytes.
 */
const LIMITE_CUERPO = '100kb';

/**
 * Registra el parser de JSON y el manejador de su error de parseo.
 *
 * Solo se registra `json`, no `urlencoded`: la API no acepta formularios. Un
 * cuerpo enviado como `application/x-www-form-urlencoded` llega sin leer y se
 * rechaza con un 400 de validacion, en vez de aceptarse con una forma que el resto
 * de la API no maneja.
 *
 * Debe llamarse antes de `app.listen()`: si no, el parser quedaria detras de las
 * rutas y estas recibirian el cuerpo sin leer.
 */
export function configurarCuerpoJson(app: INestApplication): void {
  app.use(json({ limit: LIMITE_CUERPO }));

  // Express distingue los manejadores de error por tener cuatro parametros: por
  // eso este no puede ser un `(req, res, next)` normal.
  app.use(
    (
      error: Error & { status?: number; type?: string },
      _req: Request,
      res: Response,
      next: (error?: unknown) => void,
    ) => {
      // `entity.parse.failed` es el `type` que body-parser asigna a un JSON que no
      // se puede interpretar. Se comprueba ese marcador y no el texto del mensaje,
      // que cambia entre versiones de Node.
      if (error?.type === 'entity.parse.failed') {
        res.status(400).json({
          error: 'Peticion incorrecta',
          message: 'El cuerpo de la peticion no es JSON valido',
          statusCode: 400,
        });
        return;
      }

      // Cualquier otro error sigue su curso hasta los filtros de Nest.
      next(error);
    },
  );
}
