/**
 * Utilidades para validar booleanos que llegan de fuera.
 *
 * Existe por un motivo concreto, no por gusto de abstraccion. En un query param todo
 * llega como texto y `ValidationPipe` corre con `enableImplicitConversion`, que decide
 * el tipo de destino leyendo el `design:type` que emite el decorador de la propiedad.
 * Para un `boolean` esa conversion es `Boolean(valor)`, y `Boolean('false')` es `true`:
 * un cliente que mandase `activo=false` como texto se encontraria con el registro
 * activado y sin ningun aviso.
 *
 * La conversion implicita ocurre antes que los `@Transform`, asi que un
 * `@Transform(({ value }) => ...)` ya recibe el booleo mal convertido. El original
 * sigue disponible en `obj[key]`, que es el objeto plano de partida.
 */

/**
 * Normaliza a booleo solo lo que es inequivoco: un booleo de verdad, o el texto
 * `true` o `false` sin importar la caja ni los espacios sobrantes.
 *
 * Cualquier otra cosa se devuelve tal cual, para que la validacion la rechace y el
 * cliente reciba un error en vez de un valor que no ha pedido.
 */
export function aBooleano(original: unknown): unknown {
  if (typeof original === 'boolean') return original;

  if (typeof original === 'string') {
    const normalizado = original.trim().toLowerCase();
    if (normalizado === 'true') return true;
    if (normalizado === 'false') return false;
  }

  return original;
}
