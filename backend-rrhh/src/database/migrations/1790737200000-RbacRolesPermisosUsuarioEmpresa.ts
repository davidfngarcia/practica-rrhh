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

export class RbacRolesPermisosUsuarioEmpresa1790737200000 implements MigrationInterface {
  name = 'RbacRolesPermisosUsuarioEmpresa1790737200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'CREATE TABLE `permiso` (',
        '`id` CHAR(36) NOT NULL,',
        '`codigo` VARCHAR(100) NOT NULL,',
        '`modulo` VARCHAR(50) NOT NULL,',
        '`descripcion` VARCHAR(255) NULL,',
        ...columnasAuditoria,
        '`codigo_vigente` VARCHAR(100) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_permiso_codigo` (`codigo_vigente`),',
        'KEY `idx_permiso_codigo` (`codigo`),',
        'KEY `idx_permiso_modulo` (`modulo`),',
        ...clavesAuditoria('permiso'),
        'CONSTRAINT `ck_permiso_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'CREATE TABLE `rol` (',
        '`id` CHAR(36) NOT NULL,',
        '`codigo` VARCHAR(50) NOT NULL,',
        '`nombre` VARCHAR(100) NOT NULL,',
        '`descripcion` VARCHAR(255) NULL,',
        '`es_sistema` TINYINT(1) NOT NULL DEFAULT 0,',
        ...columnasAuditoria,
        '`codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED,',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_rol_codigo` (`codigo_vigente`),',
        'KEY `idx_rol_codigo` (`codigo`),',
        'KEY `idx_rol_nombre` (`nombre`),',
        ...clavesAuditoria('rol'),
        'CONSTRAINT `ck_rol_es_sistema` CHECK (`es_sistema` IN (0, 1)),',
        'CONSTRAINT `ck_rol_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    // Tabla puente: sin `deleted_at` ni `activo`. La clave primaria ya es el par
    // (rol_id, permiso_id), asi que no hay columna que "libere" al hacer soft delete,
    // y revocar un permiso debe ser un DELETE real, no ocultar una fila.
    await queryRunner.query(
      [
        'CREATE TABLE `rol_permiso` (',
        '`rol_id` CHAR(36) NOT NULL,',
        '`permiso_id` CHAR(36) NOT NULL,',
        '`created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
        '`updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),',
        '`created_by` CHAR(36) NULL,',
        'PRIMARY KEY (`rol_id`, `permiso_id`),',
        'KEY `idx_rol_permiso_permiso` (`permiso_id`),',
        'KEY `idx_rol_permiso_created_by` (`created_by`),',
        'CONSTRAINT `fk_rol_permiso_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,',
        'CONSTRAINT `fk_rol_permiso_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,',
        'CONSTRAINT `fk_rol_permiso_permiso` FOREIGN KEY (`permiso_id`) REFERENCES `permiso` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    // Sin `ON UPDATE CASCADE` en empresa_id / usuario_id: InnoDB lo rechaza (errno 1215)
    // cuando la columna alimenta una columna generada, como `empresa_usuario_vigente`.
    // Se omite tambien en rol_id por consistencia: los UUID son inmutables.
    await queryRunner.query(
      [
        'CREATE TABLE `usuario_empresa` (',
        '`id` CHAR(36) NOT NULL,',
        '`empresa_id` CHAR(36) NOT NULL,',
        '`usuario_id` CHAR(36) NOT NULL,',
        '`rol_id` CHAR(36) NOT NULL,',
        ...columnasAuditoria,
        "`empresa_usuario_vigente` VARCHAR(80) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, CONCAT(`empresa_id`, '-', `usuario_id`), NULL)) STORED,",
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_usuario_empresa` (`empresa_usuario_vigente`),',
        'KEY `idx_usuario_empresa_empresa` (`empresa_id`),',
        'KEY `idx_usuario_empresa_usuario` (`usuario_id`),',
        'KEY `idx_usuario_empresa_rol` (`rol_id`),',
        'KEY `idx_usuario_empresa_empresa_rol` (`empresa_id`, `rol_id`),',
        ...clavesAuditoria('usuario_empresa'),
        'CONSTRAINT `fk_usuario_empresa_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_usuario_empresa_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_usuario_empresa_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `ck_usuario_empresa_activo` CHECK (`activo` IN (0, 1))',
        ')',
        SUFIJO,
      ].join('\n'),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `usuario_empresa`');
    await queryRunner.query('DROP TABLE IF EXISTS `rol_permiso`');
    await queryRunner.query('DROP TABLE IF EXISTS `rol`');
    await queryRunner.query('DROP TABLE IF EXISTS `permiso`');
  }
}
