import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnadirIdAUsuarios1790726400000 implements MigrationInterface {
  name = 'AnadirIdAUsuarios1790726400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `usuarios` ADD COLUMN `id` CHAR(36) NULL',
    );

    await queryRunner.query(
      'UPDATE `usuarios` SET `id` = UUID() WHERE `id` IS NULL',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` MODIFY COLUMN `id` CHAR(36) NOT NULL',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` DROP PRIMARY KEY, ADD PRIMARY KEY (`id`)',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` ADD UNIQUE KEY `uq_usuarios_usuario` (`usuario`)',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` ADD COLUMN `activo` TINYINT(1) NOT NULL DEFAULT 1',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    );

    await queryRunner.query(
      'ALTER TABLE `usuarios` ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `usuarios` DROP COLUMN `updated_at`, DROP COLUMN `created_at`, DROP COLUMN `activo`, DROP INDEX `uq_usuarios_usuario`, DROP PRIMARY KEY, DROP COLUMN `id`, ADD PRIMARY KEY (`usuario`)',
    );
  }
}
