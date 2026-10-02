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

export class EmpresasPersonasDepartamentosPuestos1790730000000 implements MigrationInterface {
  name = 'EmpresasPersonasDepartamentosPuestos1790730000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'CREATE TABLE `empresa` (',
        '`id` CHAR(36) NOT NULL,',
        '`codigo` VARCHAR(50) NOT NULL,',
        '`nombre` VARCHAR(150) NOT NULL,',
        '`razon_social` VARCHAR(200) NULL,',
        '`nombre_comercial` VARCHAR(150) NULL,',
        '`identificacion_tributaria` VARCHAR(64) NULL,',
        '`email` VARCHAR(150) NULL,',
        '`telefono` VARCHAR(30) NULL,',
        '`direccion` VARCHAR(255) NULL,',
        ...columnasAuditoria,
        '`codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_empresa_codigo` (`codigo_vigente`),',
        'KEY `idx_empresa_codigo` (`codigo`),',
        'KEY `idx_empresa_nombre` (`nombre`),',
        ...clavesAuditoria('empresa'),
        'CONSTRAINT `ck_empresa_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'CREATE TABLE `persona` (',
        '`id` CHAR(36) NOT NULL,',
        '`tipo_documento` VARCHAR(20) NOT NULL,',
        '`numero_documento` VARCHAR(50) NOT NULL,',
        '`nombres` VARCHAR(100) NOT NULL,',
        '`apellidos` VARCHAR(100) NOT NULL,',
        '`fecha_nacimiento` DATE NULL,',
        '`genero` CHAR(1) NULL,',
        '`email` VARCHAR(150) NULL,',
        '`telefono` VARCHAR(30) NULL,',
        '`direccion` VARCHAR(255) NULL,',
        ...columnasAuditoria,
        '`documento_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `numero_documento`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_persona_documento` (`documento_vigente`),',
        'KEY `idx_persona_numero_documento` (`numero_documento`),',
        'KEY `idx_persona_nombres` (`nombres`),',
        'KEY `idx_persona_apellidos` (`apellidos`),',
        ...clavesAuditoria('persona'),
        "CONSTRAINT `ck_persona_tipo_documento` CHECK (`tipo_documento` IN ('CC', 'CE', 'NIT', 'PASAPORTE')),",
        "CONSTRAINT `ck_persona_genero` CHECK (`genero` IS NULL OR `genero` IN ('M', 'F', 'O')),",
        'CONSTRAINT `ck_persona_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'CREATE TABLE `departamento` (',
        '`id` CHAR(36) NOT NULL,',
        '`empresa_id` CHAR(36) NOT NULL,',
        '`codigo` VARCHAR(50) NOT NULL,',
        '`nombre` VARCHAR(150) NOT NULL,',
        '`descripcion` VARCHAR(255) NULL,',
        ...columnasAuditoria,
        '`codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_departamento_codigo` (`empresa_id`, `codigo_vigente`),',
        'KEY `idx_departamento_codigo` (`codigo`),',
        'KEY `idx_departamento_empresa_nombre` (`empresa_id`, `nombre`),',
        ...clavesAuditoria('departamento'),
        'CONSTRAINT `fk_departamento_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,',
        'CONSTRAINT `ck_departamento_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'CREATE TABLE `puesto` (',
        '`id` CHAR(36) NOT NULL,',
        '`empresa_id` CHAR(36) NOT NULL,',
        '`codigo` VARCHAR(50) NOT NULL,',
        '`nombre` VARCHAR(150) NOT NULL,',
        '`descripcion` VARCHAR(255) NULL,',
        ...columnasAuditoria,
        '`codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_puesto_codigo` (`empresa_id`, `codigo_vigente`),',
        'KEY `idx_puesto_codigo` (`codigo`),',
        'KEY `idx_puesto_empresa_nombre` (`empresa_id`, `nombre`),',
        ...clavesAuditoria('puesto'),
        'CONSTRAINT `fk_puesto_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,',
        'CONSTRAINT `ck_puesto_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `puesto`');
    await queryRunner.query('DROP TABLE IF EXISTS `departamento`');
    await queryRunner.query('DROP TABLE IF EXISTS `persona`');
    await queryRunner.query('DROP TABLE IF EXISTS `empresa`');
  }
}
