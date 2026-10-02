import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Anade `CAMBIO_EMPRESA` al vocabulario de `auditoria.accion`.
 *
 * Migracion nueva y no una edicion de `RefreshTokenYAuditoria`: esa ya esta aplicada en
 * las bases existentes, y editarla no volveria a ejecutarse, de modo que el CHECK se
 * quedaria como esta en el codigo y no como esta en la base.
 *
 * El motivo de separarla es que `cambiar-empresa` se estaba auditando como `LOGOUT`.
 * Son cosas distintas: un LOGOUT es el usuario quien corta su sesion, mientras que un
 * cambio de empresa es el usuario pidiendo un token nuevo para otra empresa y solo se
 * revoca el token anterior como efecto secundario. En un log de seguridad, registrar el
 * segundo caso como el primero esconde quien se movio entre empresas sin cerrar sesion.
 */
export class AccionCambioEmpresa1790748000000 implements MigrationInterface {
  name = 'AccionCambioEmpresa1790748000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `auditoria` DROP CHECK `ck_auditoria_accion`',
    );

    await queryRunner.query(
      "ALTER TABLE `auditoria` ADD CONSTRAINT `ck_auditoria_accion` CHECK (`accion` IN ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'CAMBIO_ROL', 'CAMBIO_PERMISOS', 'CAMBIO_EMPRESA'))",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `auditoria` DROP CHECK `ck_auditoria_accion`',
    );

    await queryRunner.query(
      "ALTER TABLE `auditoria` ADD CONSTRAINT `ck_auditoria_accion` CHECK (`accion` IN ('CREAR', 'ACTUALIZAR', 'ELIMINAR', 'LOGIN', 'LOGOUT', 'LOGIN_FALLIDO', 'CAMBIO_ROL', 'CAMBIO_PERMISOS'))",
    );
  }
}
