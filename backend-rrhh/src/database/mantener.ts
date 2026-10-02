import type { Connection, RowDataPacket } from 'mysql2/promise';
import { abrirConexionDePrueba } from './semilla.js';

/**
 * Mantenimiento periodico: caduca lo que ya no sirve y acota lo que crece sin limite.
 *
 * Sin esto, `auditoria` y `refresh_token` crecen para siempre. La tabla de auditoria es la
 * que mas filas produce con diferencia, porque registra tambien los intentos de login
 * fallidos, que son justo los que mas abunda en un sistema expuesto: en la base de
 * desarrollo se acumulaban mas de mil filas solo de eso.
 *
 * Dos decisiones que conviene tener claras:
 *
 * 1. **No hay `ON DELETE CASCADE` en `auditoria`.** Sus filas apuntan a `empresa` y a
 *    `usuarios`, y se guardan precisamente porque el recurso ya no esta. Una baja logica
 *    en `empleado` no debe llevarse por delante el registro de quien lo modifico y cuando.
 *    Por eso la limpieza es un script explicito, no una cascada que un tercero active sin
 *    querer.
 *
 * 2. **Los dos retenimientos no son el mismo numero.** Un refresh token caducado no vale
 *    para nada en cuanto caduca, mientras que un registro de auditoría puede ser
 *    necesario para responder por un cambio de hace años. Por eso `refresh_token` se
 *    purga pronto y `auditoria` se conserva mucho mas.
 *
 * Por defecto el script **no borra nada**: cuenta y dice cuántas filas hay de cada cosa.
 * Hay que pasar `--aplicar` para que de verdad borre. Un `DELETE` sin confirmacion en un
 * script que alguien ejecuta por cron a las tres de la mañana no es un convenience, es
 * una forma de perder el historico sin querer.
 */

/** Dias que se conservan los refresh tokens caducados. */
const RETENCION_TOKENS_POR_DEFECTO = 30;

/** Dias que se conserva la auditoria. Mucho mas que los tokens: es historico. */
const RETENCION_AUDITORIA_POR_DEFECTO = 365;

/** Fila devuelta por el `SELECT COUNT(*)`. */
interface Conteo extends RowDataPacket {
  total: number;
}

/** Que filas hay de cada tipo, y cuantas se borrarian. */
export interface ResultadoMantenimiento {
  tokens: number;
  auditoria: number;
}

/** Lee un entero del entorno y, si no es valido, usa el valor por defecto. */
function retencion(nombre: string, porDefecto: number): number {
  const bruto = process.env[nombre];
  if (bruto === undefined || bruto.trim() === '') return porDefecto;

  const valor = Number(bruto);
  // Un `NaN` o un negativo aqui produciria un `DELETE ... WHERE fecha < NOW() - INTERVAL
  // -5 DAY`, que es un futuro: borraria la tabla entera.
  if (!Number.isInteger(valor) || valor <= 0) {
    console.warn(
      `${nombre}="${bruto}" no es un numero de dias valido; se usa ${porDefecto}.`,
    );
    return porDefecto;
  }

  return valor;
}

/**
 * Cuenta y, si `aplicar` es cierto, borra lo que caducó.
 *
 * El `COUNT` va antes del `DELETE` siempre, aunque no se vaya a borrar nada: es lo que
 * permite que la salida del script sea la misma en modo simulacion y en modo real, y que
 * se pueda comprobar que lo que habia era lo que se esperaba.
 */
export async function mantener(
  conexion: Connection,
  aplicar: boolean,
): Promise<ResultadoMantenimiento> {
  const diasTokens = retencion(
    'RETENCION_TOKENS_DIAS',
    RETENCION_TOKENS_POR_DEFECTO,
  );
  const diasAuditoria = retencion(
    'RETENCION_AUDITORIA_DIAS',
    RETENCION_AUDITORIA_POR_DEFECTO,
  );

  const [tokens] = await conexion.query<Conteo[]>(
    'SELECT COUNT(*) AS total FROM `refresh_token` WHERE `expira_en` < NOW() - INTERVAL ? DAY',
    [diasTokens],
  );

  const [auditoria] = await conexion.query<Conteo[]>(
    'SELECT COUNT(*) AS total FROM `auditoria` WHERE `creado_en` < NOW() - INTERVAL ? DAY',
    [diasAuditoria],
  );

  const resultado: ResultadoMantenimiento = {
    tokens: Number(tokens[0].total),
    auditoria: Number(auditoria[0].total),
  };

  if (!aplicar) return resultado;

  if (resultado.tokens > 0) {
    await conexion.query(
      'DELETE FROM `refresh_token` WHERE `expira_en` < NOW() - INTERVAL ? DAY',
      [diasTokens],
    );
  }

  if (resultado.auditoria > 0) {
    await conexion.query(
      'DELETE FROM `auditoria` WHERE `creado_en` < NOW() - INTERVAL ? DAY',
      [diasAuditoria],
    );
  }

  return resultado;
}

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const conexion = await abrirConexionDePrueba();

  try {
    const { tokens, auditoria } = await mantener(conexion, aplicar);

    console.log(
      `Refresh tokens caducados hace mas de ${retencion('RETENCION_TOKENS_DIAS', RETENCION_TOKENS_POR_DEFECTO)} dias: ${tokens}`,
    );
    console.log(
      `Registros de auditoria con mas de ${retencion('RETENCION_AUDITORIA_DIAS', RETENCION_AUDITORIA_POR_DEFECTO)} dias: ${auditoria}`,
    );

    if (!aplicar && (tokens > 0 || auditoria > 0)) {
      console.log(
        '\nNo se ha borrado nada. Repite con --aplicar para hacerlo.',
      );
    }
  } finally {
    await conexion.end();
  }
}

if (process.argv[1]?.endsWith('mantener.js')) {
  main().catch((error: unknown) => {
    console.error('Error en el mantenimiento:', error);
    process.exit(1);
  });
}
