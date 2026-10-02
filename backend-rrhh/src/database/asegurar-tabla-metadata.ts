import type { DataSource } from 'typeorm';

/**
 * Crea la tabla interna `typeorm_metadata` de TypeORM con PRIMARY KEY.
 *
 * Por que hace falta: en cuanto las entidades declaran columnas generadas
 * (`generatedType: 'STORED'`), `RdbmsSchemaBuilder.hasGeneratedColumns()` devuelve
 * true y TypeORM intenta crear `typeorm_metadata`. Su DDL oficial no lleva
 * PRIMARY KEY (solo lo agrega para el driver Spanner, ver
 * `RdbmsSchemaBuilder.createTypeormMetadataTable`), asi que Aiven lo rechaza con
 * `ER_TABLE_WITHOUT_PK` porque tiene `sql_require_primary_key = ON`. Eso rompia
 * tanto el arranque de la app como `npm run migration:run`.
 *
 * No se puede resolver con una migracion de TypeORM: `MigrationExecutor` llama a
 * `createMetadataTableIfNecessary()` ANTES de ejecutar el `up()`, asi que la
 * migracion moriria antes de correr. Por eso se hace aqui, con SQL directo.
 *
 * La tabla nunca recibe filas en este proyecto: las columnas generadas ya se
 * declaran con `asExpression` + `generatedType`, que es metadata en linea. Se
 * crea solo para que TypeORM pueda consultarla.
 *
 * Es idempotente: si ya existe, no hace nada.
 *
 * La PRIMARY KEY va sobre una columna `id` propia en vez de sobre las columnas de
 * TypeORM: `table`, `name`, `database` y `schema` son NULL-ables en el diseno de
 * TypeORM y MySQL no admite NULLs en una PK (`ER_PRIMARY_CANT_HAVE_NULL`). Anadir
 * `id` es lo que menos altera la forma que TypeORM espera al leer o escribir.
 */
export async function asegurarTablaMetadata(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS \`typeorm_metadata\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`type\` varchar(255) NOT NULL,
      \`database\` varchar(255) NULL,
      \`schema\` varchar(255) NULL,
      \`table\` varchar(255) NULL,
      \`name\` varchar(255) NULL,
      \`value\` text NULL,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

/**
 * Registra la expresion de cada columna GENERATED en `typeorm_metadata`.
 *
 * Sin esto, TypeORM no puede leer la expresion: `MysqlQueryRunner.getTable` la
 * pide a `typeorm_metadata` con `type = 'GENERATED_COLUMN'` porque MySQL devuelve
 * `information_schema.columns.generation_expression` ya reformateado
 * (`if((... is null),...,NULL)` frente a `IF(... IS NULL, ..., NULL)`) y no sirve
 * para comparar. Sin la fila lee `asExpression = ""`, el schema builder concluye
 * que la columna difiere y propone redefinirla.
 *
 * El valor coincide con el `asExpression` de cada entidad, asi que el `log()`
 * queda en cero drift en vez de emitir un `ALTER` cosmetico.
 *
 * Es idempotente: borra y reinserta solo las filas de este proyecto.
 */
export async function sincronizarColumnasGeneradas(
  dataSource: DataSource,
): Promise<void> {
  const database = dataSource.options.database ?? '';
  const generadas: { tabla: string; columna: string; expr: string }[] = [];

  for (const metadata of dataSource.entityMetadatas) {
    for (const columna of metadata.columns) {
      if (columna.generatedType && columna.asExpression) {
        generadas.push({
          tabla: metadata.tableName,
          columna: columna.databaseName,
          expr: columna.asExpression,
        });
      }
    }
  }

  await dataSource.query(
    `DELETE FROM \`typeorm_metadata\` WHERE \`type\` = 'GENERATED_COLUMN' AND \`database\` = ?`,
    [database],
  );

  for (const g of generadas) {
    await dataSource.query(
      `INSERT INTO \`typeorm_metadata\`
         (\`type\`, \`database\`, \`schema\`, \`table\`, \`name\`, \`value\`)
       VALUES ('GENERATED_COLUMN', ?, ?, ?, ?, ?)`,
      [database, database, g.tabla, g.columna, g.expr],
    );
  }
}
