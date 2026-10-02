/**
 * Lectura de cookies sin dependencias.
 *
 * `cookie-parser` no esta instalado y para el unico valor que necesita la API
 * (el refresh token) no compensa la dependencia: el formato de la cabecera `Cookie`
 * es `nombre=valor; nombre=valor`, sin comillas ni escapes en la practica.
 */
export function leerCookie(
  header: string | undefined,
  nombre: string,
): string | null {
  if (!header) return null;

  for (const parte of header.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) continue;

    const clave = parte.slice(0, separador).trim();
    if (clave !== nombre) continue;

    const valor = parte.slice(separador + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      // Un valor con percent-escape invalido no es un token nuestro.
      return null;
    }
  }

  return null;
}
