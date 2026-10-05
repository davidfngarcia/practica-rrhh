/**
 * Decoradores de OpenAPI.
 *
 * Se envuelven los de `@nestjs/swagger` en lugar de importarlos en cada controlador por una
 * razon concreta: las respuestas de error las decide `FiltroErrores`, no cada endpoint. Si
 * cada uno describe las suyas, el documento acaba con cuatro formas distintas de decir lo
 * mismo y el frontend tiene que deducir cual es la buena. Aqui se declara una vez.
 *
 * `ApiResponse` es una funcion en la version instalada de `@nestjs/swagger`, no una clase:
 * se llama con `ApiResponse({...})` y devuelve el decorador ya hecho.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';

/** Error tal como lo devuelve `FiltroErrores`. */
export class ErrorDto {
  /** Nombre en castellano del estado: "Sin permisos", "No encontrado"... */
  error: string;
  /** Explicacion en castellano. */
  message: string;
  statusCode: number;
  /** Solo en validacion: un motivo por cada campo que no cuadra. */
  errores?: { campo: string; mensaje: string }[];
}

/**
 * Listado paginado tal como lo devuelve `RespuestaPaginada`.
 *
 * Es generica en TypeScript, pero en el documento se documentan las formas concretas de
 * `src/common/respuesta.dto.ts` (`PaginadoPersonasDto`, `PaginadoEmpleadosDto`...):
 * Swagger no resuelve `T[]` dentro de un tipo generico, asi que un `PaginadoDto<Persona>`
 * aparecia en el documento como un objeto sin propiedades. Las clases concretas son la
 * forma que la libreria entiende sin trucos.
 */

/**
 * Marca el controlador entero como protegido y agrupa sus endpoints.
 *
 * Bearer y 401 son iguales en toda la API, asi que van a nivel de controlador en vez de
 * repetirse en los 25 endpoints.
 */
export const DocumentarGrupo = (nombre: string) =>
  applyDecorators(ApiTags(nombre), ApiBearerAuth());

/** Documenta la respuesta 200 de un endpoint. */
export const RespuestaOk = (
  descripcion: string,
  modelo: new (...args: never[]) => object,
) =>
  applyDecorators(
    ApiResponse({ status: 200, description: descripcion, type: modelo }),
  );

/**
 * Documenta la respuesta 200 de un endpoint que devuelve una lista, no un objeto.
 *
 * Va aparte de `RespuestaOk` porque `type` no acepta la clase envuelta en corchetes.
 * Pasarle `[Modelo]` a `RespuestaOk` documentaria un objeto con una propiedad `0`, que es
 * como lo leeria el generador de clientes del frontend.
 */
export const RespuestaLista = (
  descripcion: string,
  modelo: new (...args: never[]) => object,
) =>
  applyDecorators(
    ApiResponse({
      status: 200,
      description: descripcion,
      type: modelo,
      isArray: true,
    }),
  );

/** Documenta una respuesta sin cuerpo: 204 en un borrado. */
export const RespuestaSinCuerpo = (descripcion: string, codigo: 204) =>
  applyDecorators(ApiResponse({ status: codigo, description: descripcion }));

/** Crea un `ApiResponse` describiendo un error concreto de un endpoint. */
export function nuevaRespuesta(estado: number, descripcion: string) {
  return ApiResponse({
    status: estado,
    description: descripcion,
    type: ErrorDto,
  });
}

/**
 * Documenta la respuesta 201 de un alta.
 *
 * Va aparte de `RespuestaOk` porque Nest devuelve 201 en `POST` por defecto, y documentar
 * 200 en un endpoint que realmente responde 201 hace que el generador de clientes espere
 * un codigo que nunca llega. No se arregla con `@HttpCode(200)`: ese 201 es lo correcto,
 * lo que se ha creado es un recurso nuevo.
 */
export const RespuestaCreado = (
  descripcion: string,
  modelo: new (...args: never[]) => object,
) =>
  applyDecorators(
    ApiResponse({ status: 201, description: descripcion, type: modelo }),
  );

/**
 * Los errores que puede devolver cualquier endpoint protegido.
 *
 * El 404 cubre tambien "existe pero en otra empresa": el filtro no distingue entre los dos
 * casos a proposito, porque distinguirlos permitiria sondear la existencia de registros
 * ajenos. Por eso el 403 no se usa para el aislamiento entre empresas.
 */
const ERRORES_COMUNES = [
  nuevaRespuesta(
    400,
    'Peticion incorrecta. Incluye `errores` con un motivo por cada campo que no cuadra.',
  ),
  nuevaRespuesta(401, 'No autenticado: falta el token o ha caducado.'),
  nuevaRespuesta(
    403,
    'El rol en la empresa activa no tiene el permiso, o el recurso es de otra empresa.',
  ),
  nuevaRespuesta(404, 'No existe en la empresa activa.'),
];

/** Aplica las respuestas de error comunes mas las propias del endpoint. */
export const Errores = (...propias: ReturnType<typeof nuevaRespuesta>[]) =>
  applyDecorators(...ERRORES_COMUNES, ...propias);

/** El 409 que devuelve un alta que choca con un UNIQUE. */
export const CONFLICTO_UNICO = nuevaRespuesta(
  409,
  'Ya existe un registro con ese valor en esta empresa.',
);

/** El 409 que devuelve una escritura que pierde el bloqueo optimista. */
export const CONFLICTO_VERSION = nuevaRespuesta(
  409,
  'El registro cambio mientras se editaba. Vuelve a leerlo y reintenta.',
);

/** El 429 del limitador de peticiones. */
export const DEMASIADAS_PETICIONES = nuevaRespuesta(
  429,
  'Se ha superado el limite de peticiones de esta IP.',
);
