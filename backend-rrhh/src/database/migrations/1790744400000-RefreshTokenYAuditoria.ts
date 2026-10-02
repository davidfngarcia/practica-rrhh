import { MigrationInterface, QueryRunner } from 'typeorm';

const SUFIJO =
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

// Tablas de seguridad. Ninguna usa el bloque generico de `columnasAuditoria`:
//
// - `refresh_token` no lleva `activo` ni `deleted_at`: el ciclo de vida de un token es
//   expirar o revocarse, y lleva su propio `revocado_at` + `revocado_motivo` para
//   distinguir por que se cerro. Los expirados se purgan con un job.
// - `auditoria` es solo-append: si se pudiera editar o borrar dejaria de ser un
//   registro de auditoria, asi que no tiene `updated_at` ni `deleted_at`.
export class RefreshTokenYAuditoria1790744400000 implements MigrationInterface {
  name = 'RefreshTokenYAuditoria1790744400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'CREATE TABLE `refresh_token` (',
        '`id` CHAR(36) NOT NULL,',
        '`usuario_id` CHAR(36) NOT NULL,',
        '`empresa_id` CHAR(36) NULL,',
        // HMAC-SHA256 (DATA_HASH_KEY como pepper) en hexadecimal, 64 caracteres.
        // Se indexa para poder localizar el token por hash en el login, por eso no
        // puede ser bcrypt: un hash lento no se puede indexar, obligaria a recorrer
        // todas las filas. Es seguro porque el token tiene 256 bits de entropia.
        '`token_hash` CHAR(64) NOT NULL,',
        '`familia` CHAR(36) NOT NULL,',
        '`expira_en` DATETIME(3) NOT NULL,',
        '`revocado_at` DATETIME(3) NULL,',
        '`revocado_motivo` VARCHAR(100) NULL,',
        '`reemplazado_por` CHAR(36) NULL,',
        '`ultimo_uso` DATETIME(3) NULL,',
        '`ip` VARCHAR(45) NULL,',
        '`user_agent` VARCHAR(255) NULL,',
        '`creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
        'PRIMARY KEY (`id`),',
        'UNIQUE KEY `uq_refresh_token_hash` (`token_hash`),',
        'KEY `idx_refresh_token_familia` (`familia`),',
        'KEY `idx_refresh_token_usuario_expira` (`usuario_id`, `expira_en`),',
        'KEY `idx_refresh_token_empresa` (`empresa_id`),',
        'KEY `idx_refresh_token_expira` (`expira_en`),',
        'KEY `idx_refresh_token_reemplazado_por` (`reemplazado_por`),',
        'CONSTRAINT `fk_refresh_token_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_refresh_token_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_refresh_token_reemplazado_por` FOREIGN KEY (`reemplazado_por`) REFERENCES `refresh_token` (`id`) ON DELETE SET NULL,',
        // Una revocacion siempre debe tener motivo: un token cerrado sin explicacion
        // no permite reconstruir que paso.
        'CONSTRAINT `ck_refresh_token_revocado` CHECK (`revocado_at` IS NULL OR `revocado_motivo` IS NOT NULL)',
        ')',
        SUFIJO,
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'CREATE TABLE `auditoria` (',
        '`id` CHAR(36) NOT NULL,',
        // NULLABLE a proposito: hay acciones sin empresa (alta de plataforma) o sin
        // usuario autenticado (intento de login fallido, que es justo lo que hay que auditar).
        '`empresa_id` CHAR(36) NULL,',
        '`usuario_id` CHAR(36) NULL,',
        '`accion` VARCHAR(50) NOT NULL,',
        '`entidad` VARCHAR(50) NOT NULL,',
        '`entidad_id` CHAR(36) NULL,',
        '`datos_antes` JSON NULL,',
        '`datos_despues` JSON NULL,',
        '`ip` VARCHAR(45) NULL,',
        '`user_agent` VARCHAR(255) NULL,',
        '`creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
        'PRIMARY KEY (`id`),',
        'KEY `idx_auditoria_empresa_fecha` (`empresa_id`, `creado_en`),',
        'KEY `idx_auditoria_usuario_fecha` (`usuario_id`, `creado_en`),',
        'KEY `idx_auditoria_entidad` (`entidad`, `entidad_id`),',
        'KEY `idx_auditoria_fecha` (`creado_en`),',
        // RESTRICT: si se borra un usuario, sus movimientos deben seguir en el registro.
        'CONSTRAINT `fk_auditoria_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,',
        'CONSTRAINT `fk_auditoria_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,',
        // Vocabulario cerrado para `accion`: en un log, `CREATED` vs `CREAR` rompe las consultas.
        // `entidad` no lleva CHECK porque crece con cada tabla nueva del sistema.',
        "CONSTRAINT `ck_auditoria_accion` CHECK (`accion` IN ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'CAMBIO_ROL', 'CAMBIO_PERMISOS'))",
        ')',
        SUFIJO,
      ].join('\n'),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `auditoria`');
    await queryRunner.query('DROP TABLE IF EXISTS `refresh_token`');
  }
}
