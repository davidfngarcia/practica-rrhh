import { type RowDataPacket } from 'mysql2/promise';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirConexionDePrueba } from './semilla.js';

/**
 * Genera `database-rrhh/schema_mysql.sql` a partir del esquema real.
 *
 * Ese volcado lo usa el `Dockerfile` de `database-rrhh/` para levantar una base vacia de
 * un tiron. Al generarlo a mano se queda desactualizado sin que nada avise: nadie
 * recuerda anadir la migracion nueva y el contenedor arranca con un esquema que la
 * aplicacion no espera.
 *
 * Se saca de `SHOW CREATE TABLE` en lugar de `mysqldump` por dos razones: no hay
 * `mysqldump` en Windows, que es donde se ejecuta esto, y asi el resultado depende solo
 * del esquema de la base, no de la version del cliente.
 *
 * Incluye las migraciones marcadas como aplicadas y el vocabulario RBAC. Sin esas filas
 * una base recien creada no tendria ni un rol que asignar y el login no podria
 * completarse. Los datos de prueba de la aplicacion no se incluyen: esos los crea
 * `npm run semilla`.
 */

/** Tablas de las que se copian filas al volcado. */
const TABLAS_CON_DATOS = ['rol', 'permiso', 'rol_permiso'];

/** Fila de `information_schema.tables`. */
interface NombreTabla extends RowDataPacket {
  nombre: string;
}

/** Fila de `information_schema.columns`. */
interface NombreColumna extends RowDataPacket {
  nombre: string;
}

/** Fila de la tabla `migrations`. */
interface Migracion extends RowDataPacket {
  timestamp: number;
  name: string;
}

const CABECERA = `-- ---------------------------------------------------------------------------
-- Esquema de la base de datos de RRHH (MySQL 8.0).
--
-- Generado con \`npm run esquema:dump\`. El DDL sale de \`SHOW CREATE TABLE\` de cada
-- tabla, mas el vocabulario RBAC y las migraciones marcadas como aplicadas.
--
-- Este fichero NO es la fuente de verdad: esa son las migraciones de
-- \`backend-rrhh/src/database/migrations\`. Existe para levantar una base vacia sin
-- ejecutar migraciones a mano, que es lo que hace el \`Dockerfile\` de este directorio al
-- copiarlo a \`docker-entrypoint-initdb.d\`.
--
-- Si cambias una migracion, vuelve a ejecutar \`npm run esquema:dump\` en lugar de editarlo
-- a mano: si no, acaba describiendo un esquema que no existe en ninguna parte.
--
-- \`persona.numero_documento\`, \`empleado.salario_cifrado\` e \`empleado.iban_cifrado\`
-- guardan texto cifrado (AES-256-GCM). Los localiza el indice HMAC de la fila de al lado,
-- no una busqueda por texto. Ver \`backend-rrhh/docs/esquema.md\`.
--
-- Uso: mysql -u <usuario> -p < schema_mysql.sql
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS \`practica_rrhh\`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE \`practica_rrhh\`;
`;

const APERTURA = `/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
`;

const CIERRE = `
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
`;

const COMENTARIO_MIGRACIONES = `
-- Las migraciones se marcan como aplicadas a proposito: este fichero crea el esquema ya
-- completo. Si \`migrations\` quedara vacio, TypeORM intentaria aplicar encima migraciones
-- cuyas tablas ya existirian y la instalacion fallaria en la primera.
`;

const COMENTARIO_RBAC = `
-- Vocabulario RBAC: roles, permisos y su asignacion. Sin estas filas una base recien
-- creada no tendria ningun rol que asignar y el login no podria completarse. Los datos
-- de prueba de la aplicacion no van aqui: los crea \`npm run semilla\`.
`;

/** Escapa un valor para escribirlo en una sentencia SQL. */
function literal(valor: unknown): string {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'boolean') return valor ? '1' : '0';
  if (valor instanceof Date) {
    // MySQL guarda hasta milisegundos; `toISOString` da 3 decimales ya.
    return `'${valor.toISOString().slice(0, 23).replace('T', ' ')}'`;
  }
  return `'${String(valor).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/**
 * Devuelve los identificadores a comillas invertidas.
 *
 * El servidor de desarrollo tiene `ANSI_QUOTES` activo, y entonces `SHOW CREATE TABLE`
 * emite los identificadores entrecomillados: "salario_cifrado". En un MySQL sin ese modo
 * eso no es un identificador sino un literal de cadena, y el `CREATE TABLE` no compila.
 * Los valores del DDL van con comillas simples, de modo que convertir las dobles no
 * toca ningun dato.
 */
function conComillasInvertidas(crear: string): string {
  return crear.replace(/"([^"]*)"/g, '`$1`');
}

/** Envuelve un `CREATE TABLE` con el bloque de comentarios de version que emite mysqldump. */
function bloqueCreate(crear: string): string {
  return `/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
${crear};
/*!40101 SET character_set_client = @saved_cs_client */;
`;
}

/**
 * Ruta del volcado, relativa a la raiz del repositorio.
 *
 * Se sube desde `src/database/` o `dist/database/`, tres niveles, hasta quedar en
 * `practica-rrhh/`, y de ahi se baja a `database-rrhh/`.
 */
function rutaDestino(): string {
  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'database-rrhh',
    'schema_mysql.sql',
  );
}

/**
 * Escribe el volcado del esquema y devuelve un resumen de lo que contiene.
 *
 * Se exporta separado del arranque para poder probarlo sin tocar el fichero.
 */
export async function generarEsquema(): Promise<{
  ruta: string;
  tablas: number;
  migraciones: number;
}> {
  const conexion = await abrirConexionDePrueba();

  try {
    const [tablas] = await conexion.query<NombreTabla[]>(
      `SELECT table_name AS nombre
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );

    // `typeorm_metadata` no pertenece al esquema: la crea TypeORM si le hace falta y no
    // la quiere nadie. Sin este filtro, el volcado la congelaria.
    const nombres = tablas
      .map((t) => t.nombre)
      .filter((n) => n !== 'typeorm_metadata');

    const ddl: string[] = [];
    for (const tabla of nombres) {
      const [filas] = await conexion.query<RowDataPacket[]>(
        `SHOW CREATE TABLE \`${tabla}\``,
      );
      ddl.push(
        `DROP TABLE IF EXISTS \`${tabla}\`;\n` +
          bloqueCreate(conComillasInvertidas(filas[0]['Create Table'])),
      );
    }

    const [migraciones] = await conexion.query<Migracion[]>(
      'SELECT `timestamp`, `name` FROM `migrations` ORDER BY `timestamp`',
    );

    const datos: string[] = [];
    for (const tabla of TABLAS_CON_DATOS) {
      if (!nombres.includes(tabla)) continue;

      const [columnas] = await conexion.query<NombreColumna[]>(
        `SELECT column_name AS nombre
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND extra NOT LIKE '%GENERATED%'
          ORDER BY ordinal_position`,
        [tabla],
      );

      if (columnas.length === 0) continue;

      const campos = columnas.map((c) => `\`${c.nombre}\``);

      const [filas] = await conexion.query<RowDataPacket[]>(
        `SELECT ${campos.join(', ')} FROM \`${tabla}\``,
      );
      if (filas.length === 0) continue;

      // Las columnas generadas se excluyen a proposito. `SELECT *` las devuelve y MySQL
      // rechaza que se les asigne un valor: el error dice que la expresion de la columna
      // no vale, cuando lo que falla es el INSERT.
      const valores = filas
        .map((fila) => `(${Object.values(fila).map(literal).join(',')})`)
        .join(',\n');

      datos.push(
        `LOCK TABLES \`${tabla}\` WRITE;\n` +
          `/*!40000 ALTER TABLE \`${tabla}\` DISABLE KEYS */;\n` +
          `INSERT INTO \`${tabla}\` (${campos.join(', ')}) VALUES\n${valores};\n` +
          `/*!40000 ALTER TABLE \`${tabla}\` ENABLE KEYS */;\n` +
          `UNLOCK TABLES;`,
      );
    }

    const aplicadas = migraciones
      .map((m) => `(${m.timestamp},${literal(m.name)})`)
      .join(',\n');

    const contenido = [
      CABECERA,
      APERTURA,
      ddl.join('\n'),
      CIERRE,
      COMENTARIO_MIGRACIONES +
        `INSERT INTO \`migrations\` (\`timestamp\`, \`name\`) VALUES\n${aplicadas};`,
      COMENTARIO_RBAC,
      APERTURA,
      datos.join('\n'),
      CIERRE,
    ].join('\n');

    const ruta = rutaDestino();
    writeFileSync(ruta, contenido, 'utf8');

    return { ruta, tablas: nombres.length, migraciones: migraciones.length };
  } finally {
    await conexion.end();
  }
}

async function main(): Promise<void> {
  const { ruta, tablas, migraciones } = await generarEsquema();
  console.log(
    `Volcado escrito en ${ruta}: ${tablas} tablas y ${migraciones} migraciones aplicadas.`,
  );
}

if (process.argv[1]?.endsWith('generar-esquema.js')) {
  main().catch((error: unknown) => {
    console.error('Error al generar el volcado del esquema:', error);
    process.exit(1);
  });
}
