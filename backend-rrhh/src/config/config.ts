/**
 * Validacion de variables de entorno.
 *
 * Falla al arrancar en lugar de dejar que la app quede medio configurada: un
 * `JWT_SECRET` ausente con fallback en el codigo significa tokens firmados con una
 * clave que cualquiera puede conocer.
 */

export interface ConfigApp {
  jwtSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
  dataHashKey: string;
  dataEncryptionKey: string;
  port: number;
  nodeEnv: string;
  throttleGlobal: number;
  throttleLogin: number;
  throttleRefresh: number;
}

function requerido(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor || valor.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Revisa .env o .env.template.`,
    );
  }
  return valor.trim();
}

function entero(nombre: string, pordefecto: number): number {
  const bruto = process.env[nombre];
  if (!bruto) return pordefecto;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `${nombre} debe ser un entero positivo (valor recibido: "${bruto}").`,
    );
  }
  return n;
}

/** Un secreto mas corto que esto se considera comprometido. */
function exigirLargo(nombre: string, valor: string, minimo: number): string {
  if (valor.length < minimo) {
    throw new Error(
      `${nombre} debe tener al menos ${minimo} caracteres (tiene ${valor.length}).`,
    );
  }
  return valor;
}

export function cargarConfig(): ConfigApp {
  const jwtSecret = exigirLargo('JWT_SECRET', requerido('JWT_SECRET'), 32);
  const dataHashKey = exigirLargo(
    'DATA_HASH_KEY',
    requerido('DATA_HASH_KEY'),
    32,
  );

  // Clave del cifrado en reposo de las columnas sensibles (documento, salario, IBAN).
  // Antes era opcional porque no la usaba nadie; con `CifradoService` pasa a ser
  // obligatoria, porque arrancar sin ella significaria guardar datos en claro.
  const dataEncryptionKey = exigirLargo(
    'DATA_ENCRYPTION_KEY',
    requerido('DATA_ENCRYPTION_KEY'),
    32,
  );

  // El refresh se firma con una clave distinta al access: si una se filtra, la
  // otra sigue siendo desconocida y no permiteTokens de larga duracion.
  const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET?.trim()
    ? exigirLargo(
        'JWT_REFRESH_SECRET',
        process.env.JWT_REFRESH_SECRET.trim(),
        32,
      )
    : `${jwtSecret}.refresh`;

  if (jwtRefreshSecret === jwtSecret) {
    throw new Error('JWT_REFRESH_SECRET debe ser distinto de JWT_SECRET.');
  }

  return {
    jwtSecret,
    jwtRefreshSecret,
    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN?.trim() || '15m',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN?.trim() || '7d',
    dataHashKey,
    dataEncryptionKey,
    port: entero('PORT', 3000),
    nodeEnv: process.env.NODE_ENV?.trim() || 'development',
    // Limites de peticiones por minuto y por IP. Configurables para poder subir el
    // de login en las pruebas, que necesitan muchos logins seguidos.
    throttleGlobal: entero('THROTTLE_GLOBAL', 120),
    throttleLogin: entero('THROTTLE_LOGIN', 5),
    throttleRefresh: entero('THROTTLE_REFRESH', 30),
  };
}

let instancia: ConfigApp | null = null;

export function configApp(): ConfigApp {
  if (!instancia) instancia = cargarConfig();
  return instancia;
}
