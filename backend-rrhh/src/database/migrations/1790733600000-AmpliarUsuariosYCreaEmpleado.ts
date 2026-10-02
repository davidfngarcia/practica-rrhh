import { MigrationInterface, QueryRunner } from 'typeorm';

const SUFIJO =
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const columnasAuditoria = [
  '`activo` TINYINT(1) NOT NULL DEFAULT 1,',
  '`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
  '`updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),',
  '`created_by` CHAR(36) NULL,',
  '`updated_by` CHAR(36) NULL,',
  '`deleted_at` DATETIME(3) NULL,',
];

const clavesAuditoria = (tabla: string) => [
  `KEY \`idx_${tabla}_created_by\` (\`created_by\`),`,
  `KEY \`idx_${tabla}_updated_by\` (\`updated_by\`),`,
  `CONSTRAINT \`fk_${tabla}_created_by\` FOREIGN KEY (\`created_by\`) REFERENCES \`usuarios\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,`,
  `CONSTRAINT \`fk_${tabla}_updated_by\` FOREIGN KEY (\`updated_by\`) REFERENCES \`usuarios\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,`,
];

export class AmpliarUsuariosYCreaEmpleado1790733600000 implements MigrationInterface {
  name = 'AmpliarUsuariosYCreaEmpleado1790733600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // `email` queda NULLABLE a proposito: el usuario `dadiv` existente no tiene correo y
    // no se inventara data ficticia. MySQL admite varios NULL en un indice UNIQUE,
    // asi que la unicidad entre correos reales sigue garantizada. El NOT NULL se
    // impondra en la capa de API cuando exista el registro de usuarios.
    await queryRunner.query(
      [
        'ALTER TABLE `usuarios`',
        'ADD COLUMN `email` VARCHAR(150) NULL AFTER `password_hash`,',
        'ADD COLUMN `ultimo_acceso` DATETIME(3) NULL,',
        'ADD UNIQUE KEY `uq_usuarios_email` (`email`)',
      ].join('\n'),
    );

    // Indices UNIQUE (empresa_id, id) en departamento y puesto.
    // Son el destino de las llaves foraneas compuestas de `empleado`, que son las que
    // impiden asignar a un empleado un departamento o puesto de OTRA empresa.
    await queryRunner.query(
      'ALTER TABLE `departamento` ADD UNIQUE KEY `uq_departamento_empresa_id` (`empresa_id`, `id`)',
    );
    await queryRunner.query(
      'ALTER TABLE `puesto` ADD UNIQUE KEY `uq_puesto_empresa_id` (`empresa_id`, `id`)',
    );

    await queryRunner.query(
      [
        'CREATE TABLE `empleado` (',
        '`id` CHAR(36) NOT NULL,',
        '`empresa_id` CHAR(36) NOT NULL,',
        '`persona_id` CHAR(36) NOT NULL,',
        '`departamento_id` CHAR(36) NULL,',
        '`puesto_id` CHAR(36) NULL,',
        "`tipo_contrato` VARCHAR(20) NOT NULL DEFAULT 'PLANTA',",
        '`fecha_ingreso` DATE NOT NULL,',
        '`fecha_fin` DATE NULL,',
        ...columnasAuditoria,
        "`empresa_persona_vigente` VARCHAR(80) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, CONCAT(`empresa_id`, '-', `persona_id`), NULL)) STORED,",
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_empleado_empresa_persona` (`empresa_persona_vigente`),',
        'KEY `idx_empleado_empresa` (`empresa_id`),',
        'KEY `idx_empleado_persona` (`persona_id`),',
        'KEY `idx_empleado_departamento` (`departamento_id`),',
        'KEY `idx_empleado_puesto` (`puesto_id`),',
        'KEY `idx_empleado_fecha_ingreso` (`fecha_ingreso`),',
        ...clavesAuditoria('empleado'),
        // Sin `ON UPDATE CASCADE`: InnoDB rechaza (errno 1215) una FK con cascada de
        // actualizacion cuya columna participe en la expresion de una columna generada.
        // `empresa_id` y `persona_id` alimentan `empresa_persona_vigente`, asi que aqui
        // solo se permite `ON DELETE`. Es irrelevante en la practica: los UUID son
        // inmutables y no se actualizan nunca.
        'CONSTRAINT `fk_empleado_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_empleado_persona` FOREIGN KEY (`persona_id`) REFERENCES `persona` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_empleado_departamento` FOREIGN KEY (`empresa_id`, `departamento_id`) REFERENCES `departamento` (`empresa_id`, `id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_empleado_puesto` FOREIGN KEY (`empresa_id`, `puesto_id`) REFERENCES `puesto` (`empresa_id`, `id`) ON DELETE RESTRICT,',
        "CONSTRAINT `ck_empleado_tipo_contrato` CHECK (`tipo_contrato` IN ('SERVICIOS', 'PLANTA', 'CONTRATO', 'PRACTICAS', 'TEMPORAL')),",
        'CONSTRAINT `ck_empleado_fechas` CHECK (`fecha_fin` IS NULL OR `fecha_fin` >= `fecha_ingreso`),',
        'CONSTRAINT `ck_empleado_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `empleado`');
    await queryRunner.query(
      'ALTER TABLE `departamento` DROP INDEX `uq_departamento_empresa_id`',
    );
    await queryRunner.query(
      'ALTER TABLE `puesto` DROP INDEX `uq_puesto_empresa_id`',
    );
    await queryRunner.query(
      [
        'ALTER TABLE `usuarios`',
        'DROP INDEX `uq_usuarios_email`,',
        'DROP COLUMN `ultimo_acceso`,',
        'DROP COLUMN `email`',
      ].join('\n'),
    );
  }
}
