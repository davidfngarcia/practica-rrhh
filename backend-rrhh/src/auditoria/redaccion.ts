/**
 * Ocultamiento de datos sensibles antes de escribirlos en la tabla de auditoria.
 *
 * El problema que resuelve: los servicios de negocio auditan la misma forma que
 * devuelven por la API, y esa forma viene descifrada. `numero_documento`, `salario` e
 * `iban` se guardan cifrados en su propia tabla, pero si se copian tal cual a
 * `auditoria.datos_despues` quedan en texto claro en una tabla que nadie recuerda
 * tener cifrada y a la que se consulta para "¿quien cambio esto y cuando?". Eso
 * deshace el cifrado en reposo justo en la tabla mas consultada del sistema.
 *
 * Por que se oculta aqui y no en cada servicio: es una propiedad de la tabla de
 * auditoria, no de un servicio. Si el ocultamiento dependiera de que cada servicio se
 * acuerde, bastaria con que uno nuevo audite sin hacerlo para volver a filtrar.
 */

/** Texto que sustituye a un valor sensible. */
export const OCULTO = '[oculto]';

/**
 * Claves cuyo valor no debe llegar a la tabla de auditoria, en minusculas.
 *
 * Se incluyen tanto la forma que ve el cliente (`numero_documento`, `salario`, `iban`)
 * como las columnas cifradas (`documento_cifrado`, `iban_cifrado`). Las columnas ya
 * van cifradas, pero auditarlas como ciphertext daria la falsa impresion de que la
 * fila esta protegida cuando el resto del registro no lo esta.
 *
 * La clave de autenticacion no se audita en ningun sitio hoy, pero aparece en la lista
 * porque el hash es el tipo de dato que nunca debe quedar en un log.
 */
const CLAVES_SENSIBLES = new Set([
  'numero_documento',
  'documento_cifrado',
  'salario',
  'iban',
  'iban_cifrado',
  'salario_cifrado',
  'password',
  'password_hash',
  'contrasena',
  'contrasena_hash',
]);

/** Valores que se copian tal cual: no son contenedores que haya que recorrer. */
function esValorOpaco(valor: object): boolean {
  return (
    valor instanceof Date ||
    Buffer.isBuffer(valor) ||
    valor instanceof Map ||
    valor instanceof Set
  );
}

/**
 * Copia el valor ocultando las claves sensibles, incluidos los niveles anidados.
 *
 * Se recorren tambien las instancias de clase, no solo los objetos literales, porque un
 * servicio puede auditar una entidad de TypeORM y sus propiedades own son las columnas.
 *
 * El `Set` lleva el camino recorrido, no todo lo visto. Marcar como `[circular]` a un
 * objeto que simplemente aparece dos veces seria falso —no hay ningun ciclo— y perderia
 * la segunda copia: si dos campos apuntan a la misma persona, en la auditoria uno tendria
 * los datos y el otro un `[circular]`. Un objeto compartido se copia dos veces, que es
 * ademas lo que hace `JSON.stringify`, y `[circular]` queda reservado al bucle de verdad,
 * en el que no hay salida.
 */
export function ocultarSensibles(
  valor: unknown,
  camino: Set<object> = new Set(),
): unknown {
  if (Array.isArray(valor)) {
    return valor.map((elemento) => ocultarSensibles(elemento, camino));
  }

  if (typeof valor !== 'object' || valor === null || esValorOpaco(valor)) {
    return valor;
  }

  if (camino.has(valor)) {
    return '[circular]';
  }

  camino.add(valor);
  try {
    const salida: Record<string, unknown> = {};
    for (const [clave, contenido] of Object.entries(valor)) {
      salida[clave] = CLAVES_SENSIBLES.has(clave.toLowerCase())
        ? OCULTO
        : ocultarSensibles(contenido, camino);
    }
    return salida;
  } finally {
    // Se sale del camino al terminar: lo que se visito antes en otra rama no es un ciclo
    // con esta, es un objeto compartido.
    camino.delete(valor);
  }
}
