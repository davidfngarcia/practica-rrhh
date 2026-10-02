import { type RowDataPacket } from 'mysql2/promise';
import {
  CifradoService,
  CONTEXTO_DOCUMENTO_PERSONA,
} from '../common/cifrado.service.js';
import { abrirConexionDePrueba } from './semilla.js';

/**
 * Convierte a cifrado los documentos de identidad que quedaron en claro.
 *
 * La migracion `JerarquiaYCamposSensibles1790752000000` cambia el significado de
 * `persona.numero_documento`: pasa a contener texto cifrado en lugar del numero. Cambiar
 * el tipo de la columna no convierte lo que ya hay dentro, asi que las personas que ya
 * estaban dadas de alta se quedan con el documento en claro y la aplicacion, al leerlas,
 * intentaria descifrar un numero suelto y reventaria.
 *
 * Este script es el que arregla esas filas. Vive fuera de la migracion a proposito: cifrar
 * exige `DATA_ENCRYPTION_KEY`, y una migracion no deberia depender de un secreto de la
 * aplicacion para poder ejecutarse.
 *
 * Es idempotente: solo toca las filas cuyo `documento_indice` sigue a NULL y cuyo valor
 * no tiene ya el prefijo del formato cifrado, que son exactamente las que siguen en
 * claro. Se puede ejecutar tantas veces como haga falta.
 */

/** Fila de `persona` que hay que cifrar. */
interface PersonaPendiente extends RowDataPacket {
  id: string;
  numero_documento: string;
}

/** Fila de `persona` que ya tiene ese indice y bloquea el UNIQUE. */
interface DocumentoDuplicado extends RowDataPacket {
  id: string;
  numero_documento: string;
  documento_indice: string | null;
}

/**
 * Cifra los documentos pendientes.
 *
 * Devuelve el numero de filas convertidas y las que no se pudieron convertir.
 */
export async function cifrarDocumentos(): Promise<{
  convertidas: number;
  incompatibles: string[];
}> {
  const conexion = await abrirConexionDePrueba();

  try {
    // `documento_indice IS NULL` es el criterio de "pendiente": una fila ya cifrada
    // tiene indice, y una dada de baja antes de la migracion tambien lo tendra null pero
    // su `documento_indice_vigente` es NULL igualmente, asi que no estorba.
    const [pendientes] = await conexion.query<PersonaPendiente[]>(
      `SELECT id, numero_documento
         FROM persona
        WHERE documento_indice IS NULL
          AND numero_documento NOT LIKE 'v1:%'`,
    );

    const incompatibles: string[] = [];

    if (pendientes.length === 0) {
      return { convertidas: 0, incompatibles };
    }

    const cifrado = new CifradoService();

    // Antes de cifrar hay que comprobar si el documento ya esta ocupado por otra persona
    // viva. Al calcular el indice, dos filas que compartian documento pasan a tener el
    // mismo, y eso hace saltar el UNIQUE en la actualizacion. Es algo que el cifrado no
    // puede arreglar por si solo: la duplicidad ya estaba en los datos y hay que decidir
    // cual de las dos se queda. Se comprueba fila a fila porque el indice de cada una
    // depende de su propio documento.
    for (const persona of pendientes) {
      const indice = cifrado.indiceCiego(
        // Se usa la constante compartida y no el literal: si el contexto cambiara en
        // `cifrado.service.ts`, este script cifraria con un indice que el servicio ya
        // no busca, y las personas quedarian sin localizar sin que nada fallara.
        CONTEXTO_DOCUMENTO_PERSONA,
        persona.numero_documento,
      );

      const [choque] = await conexion.query<DocumentoDuplicado[]>(
        `SELECT id, numero_documento, documento_indice
           FROM persona
          WHERE documento_indice = ?
            AND deleted_at IS NULL
            AND id <> ?
          LIMIT 1`,
        [indice, persona.id],
      );

      if (choque.length > 0) {
        // El aviso incluye el documento y no solo los identificadores: el operador
        // tiene que decidir cual de las dos personas se queda con el, y con el id
        // tendria que ir a la tabla a buscarlo justo cuando ya no esta en claro.
        incompatibles.push(
          `las personas ${persona.id} y ${choque[0].id} comparten el documento ` +
            `${persona.numero_documento}: no se puede cifrar sin decidir cual se queda`,
        );
        continue;
      }

      await conexion.query(
        `UPDATE persona
            SET numero_documento = ?, documento_indice = ?
          WHERE id = ? AND documento_indice IS NULL`,
        [cifrado.cifrar(persona.numero_documento), indice, persona.id],
      );
    }

    return {
      convertidas: pendientes.length - incompatibles.length,
      incompatibles,
    };
  } finally {
    await conexion.end();
  }
}

async function main(): Promise<void> {
  const { convertidas, incompatibles } = await cifrarDocumentos();

  console.log(`Documentos convertidos a cifrado: ${convertidas}`);

  if (incompatibles.length > 0) {
    console.log('\nFilas que no se han podido convertir:');
    for (const aviso of incompatibles) console.log(`  - ${aviso}`);
    // Se sale con codigo distinto de cero para que un script de despliegue lo detecte y
    // no de por buena una conversion que ha dejado filas sin cifrar.
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('cifrar-datos.js')) {
  main().catch((error: unknown) => {
    console.error('Error al cifrar los datos existentes:', error);
    process.exit(1);
  });
}
