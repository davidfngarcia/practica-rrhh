import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { crearRolesPlantilla, type EjecutorSql } from '../plantilla-roles.js';

/**
 * Los roles pasan de ser un catálogo global a ser de cada empresa.
 *
 * Motivo: con `rol` global, un `POST /roles` desde la sesión de una empresa creaba un
 * rol que aparecía en el `GET /roles` de todas las demás. El nombre y el código de un
 * rol son información de la organización que lo creó, y un tenant no debe ver los de
 * otro. La unicidad también cambia deute: dos empresas pueden querer un rol `CONTABLE`,
 * y con el único global `uq_rol_codigo` la segunda no podría crearlo.
 *
 * `empresa_id` queda NULLABLE a propósito, y no por pereza:
 *
 *   - NULL + `es_sistema = 1` = rol PLANTILLA. Son los tres que siembra
 *     `SeedRolesYPermisos`, y no pertenecen a ninguna empresa.
 *   - empresa concreta = rol de ese tenant, ya sea copia de la plantilla o creado a mano.
 *
 * Tiene que ser nullable porque las migraciones corren antes que la semilla de
 * desarrollo: en una base recien creada la tabla `empresa` esta vacia cuando esta
 * migracion se ejecuta, asi que no hay a quien replicarle nada. Las plantillas se
 * quedan como origen y `crearRolesPlantilla` copia de ellas al dar de alta una empresa.
 *
 * Sobre el unique: se sustituye `codigo_vigente` (solo `codigo`) por
 * `empresa_codigo_vigente`, que antepone el `empresa_id` cuando lo hay. Asi conviven
 * los dos casos sin reglas repartidas en dos indices:
 *
 *   - plantilla:  'ADMIN_EMPRESA'     -> unica en toda la base
 *   - tenant:     'e...000a-CONTABLE' -> unica dentro de esa empresa
 *
 * MySQL no permite alterar la expresion de una columna generada en sitio, asi que se
 * tira y se vuelve a crear. El orden importa: se sueltan el indice y la columna
 * antiguas ANTES de añadir la nueva, porque durante el `ALTER` ambas existirian y la
 * nueva no podria anadir su unicidad con la vieja todavia en su sitio.
 */
export class RolesPorEmpresa1790759200000 implements MigrationInterface {
  name = 'RolesPorEmpresa1790759200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. La columna de empresa, nullable, mas su indice y su FK.
    await queryRunner.query(
      [
        'ALTER TABLE `rol`',
        'ADD COLUMN `empresa_id` CHAR(36) NULL AFTER `id`,',
        'ADD KEY `idx_rol_empresa` (`empresa_id`),',
        'ADD KEY `idx_rol_empresa_codigo` (`empresa_id`, `codigo`),',
        'ADD CONSTRAINT `fk_rol_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION',
      ].join('\n'),
    );

    // 2. Sustituir la unicidad global por la unicidad por empresa.
    await queryRunner.query(
      [
        'ALTER TABLE `rol`',
        'DROP INDEX `uq_rol_codigo`,',
        'DROP COLUMN `codigo_vigente`,',
        'ADD COLUMN `empresa_codigo_vigente` VARCHAR(100)',
        "  GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, IF(`empresa_id` IS NULL, `codigo`, CONCAT(`empresa_id`, '-', `codigo`)), NULL)) STORED,",
        'ADD UNIQUE KEY `uq_rol_empresa_codigo` (`empresa_codigo_vigente`)',
      ].join('\n'),
    );

    // 3. Replicar las plantillas en las empresas que ya existieran.
    //
    // En una base ya sembrada puede haberlas; en una recien creada, cero, porque la
    // semilla de desarrollo va despues. Se deja el paso por si alguien desarrollo contra
    // una base con empresas antes de aplicar esta migracion.
    // A diferencia de `Connection.query` de mysql2, `QueryRunner.query` devuelve las
    // filas directamente, sin la tupla `[filas, campos]`.
    const empresas = (await queryRunner.query(
      'SELECT `id` FROM `empresa`',
    )) as RowDataPacket[];
    for (const empresa of empresas) {
      await this.replicarPlantillas(queryRunner, empresa.id as string);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Reapuntar las membresias a la plantilla antes de borrar las copias: la FK es
    // RESTRICT, y si se borraran primero el DELETE fallaria. Es el comportamiento
    // correcto, no un problema que tapar.
    await queryRunner.query(
      [
        'UPDATE `usuario_empresa` ue',
        'JOIN `rol` copia ON copia.`id` = ue.`rol_id`',
        'JOIN `rol` plantilla',
        '  ON plantilla.`empresa_id` IS NULL',
        '  AND plantilla.`codigo` = copia.`codigo`',
        'SET ue.`rol_id` = plantilla.`id`',
      ].join('\n'),
    );

    // `rol_permiso` cae por ON DELETE CASCADE; aun asi se borra primero para que el
    // borrado de `rol` no dependa de que MySQL resuelva la cascada.
    await queryRunner.query(
      'DELETE rp FROM `rol_permiso` rp JOIN `rol` r ON r.`id` = rp.`rol_id` WHERE r.`empresa_id` IS NOT NULL',
    );
    await queryRunner.query('DELETE FROM `rol` WHERE `empresa_id` IS NOT NULL');

    await queryRunner.query(
      [
        'ALTER TABLE `rol`',
        'DROP INDEX `uq_rol_empresa_codigo`,',
        'DROP COLUMN `empresa_codigo_vigente`,',
        'DROP KEY `idx_rol_empresa_codigo`,',
        'DROP KEY `idx_rol_empresa`,',
        'DROP FOREIGN KEY `fk_rol_empresa`,',
        'DROP COLUMN `empresa_id`,',
        'ADD COLUMN `codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'ADD UNIQUE KEY `uq_rol_codigo` (`codigo_vigente`)',
      ].join('\n'),
    );
  }

  /**
   * Copia las plantillas de esa empresa y le reapunta las membresias.
   *
   * Se delega en `crearRolesPlantilla` en vez de repetir el INSERT aqui: la semilla de
   * desarrollo y el alta de empresa de plataforma necesitan exactamente la misma
   * operacion, y dos copias de este SQL acabarian divergiendo sin que nadie se entere.
   */
  private async replicarPlantillas(
    queryRunner: QueryRunner,
    empresaId: string,
  ): Promise<void> {
    await crearRolesPlantilla(ejecutorDe(queryRunner), empresaId);

    await queryRunner.query(
      [
        'UPDATE `usuario_empresa` ue',
        'JOIN `rol` viejo ON viejo.`id` = ue.`rol_id`',
        'JOIN `rol` nuevo',
        '  ON nuevo.`empresa_id` = ue.`empresa_id`',
        '  AND nuevo.`codigo` = viejo.`codigo`',
        'SET ue.`rol_id` = nuevo.`id`',
        'WHERE ue.`empresa_id` = ?',
        '  AND viejo.`empresa_id` IS NULL',
      ].join('\n'),
      [empresaId],
    );
  }
}

/**
 * Adapta el `QueryRunner` de TypeORM a `EjecutorSql`.
 *
 * `QueryRunner.query` devuelve las filas directamente, sin la tupla `[filas, campos]` de
 * mysql2, y sus tipos genericos no admiten `ResultSetHeader`. El casts vive aqui y no en
 * `crearRolesPlantilla`, para que el helper no tenga que adivinar con que motor esta
 * hablando.
 */
function ejecutorDe(queryRunner: QueryRunner): EjecutorSql {
  return {
    async consultar(sql, valores) {
      return (await queryRunner.query(sql, valores)) as RowDataPacket[];
    },
    async ejecutar(sql, valores) {
      const cabecera = (await queryRunner.query(sql, valores)) as
        ResultSetHeader | undefined;
      return cabecera?.affectedRows ?? 0;
    },
  };
}
