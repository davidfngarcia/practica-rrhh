import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Modelo de datos de la Fase 1: jerarquia de usuarios, bloqueo optimista, codigo de
 * empleado, baja logica en usuarios y cifrado de datos sensibles.
 *
 * Todo lo que ya existe se migra con datos, no se recrea: estas tablas tienen
 * informacion real y una migracion que las volviera a crear la perderia.
 *
 * Nota sobre el formato: en un `ALTER TABLE` cada clausula va separada por coma. No hay
 * que olvidarlo porque el error que produce MySQL ("syntax near 'ADD COLUMN...'") no dice
 * que falte una coma.
 */
export class JerarquiaYCamposSensibles1790752000000 implements MigrationInterface {
  name = 'JerarquiaYCamposSensibles1790752000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // --- Jerarquia de usuarios -------------------------------------------------
    //
    // `parent_user_id` es una autorreferencia: un usuario cuelga de quien lo creo. Va
    // con ON DELETE RESTRICT porque no se puede dejar huerfano un usuario que tiene
    // hijos colgando. La prevencion de ciclos no se puede expresar en la base (MySQL no
    // tiene una asercion que pueda consultar la propia tabla mientras se inserta) y la
    // hace `UsersService.puedeColgarseDe()` antes de escribir.
    await queryRunner.query(
      [
        'ALTER TABLE `usuarios`',
        'ADD COLUMN `parent_user_id` CHAR(36) NULL AFTER `email`,',
        'ADD COLUMN `deleted_at` DATETIME(3) NULL,',
        'ADD COLUMN `created_by` CHAR(36) NULL,',
        'ADD COLUMN `updated_by` CHAR(36) NULL,',
        'ADD COLUMN `usuario_vigente` VARCHAR(128) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `usuario`, NULL)) STORED,',
        'ADD COLUMN `email_vigente` VARCHAR(150) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `email`, NULL)) STORED',
      ].join('\n'),
    );

    // El UNIQUE pasa de `usuario` a la columna generada: si no, un usuario dado de
    // baja seguiria reservando su nombre de acceso para siempre, que es justo lo que
    // el resto del modelo no hace con `codigo` ni con el indice del documento.
    await queryRunner.query(
      'ALTER TABLE `usuarios` DROP INDEX `uq_usuarios_usuario`',
    );
    await queryRunner.query(
      'ALTER TABLE `usuarios` DROP INDEX `uq_usuarios_email`',
    );

    await queryRunner.query(
      [
        'ALTER TABLE `usuarios`',
        // Los indices sobre la columna cruda se conservan porque se sigue buscando por
        // `usuario`/`email` sin filtrar por vigencia, y `usuario` deja de estar indexada
        // al mover el UNIQUE a la columna generada.
        'ADD UNIQUE KEY `uq_usuarios_usuario` (`usuario_vigente`),',
        'ADD UNIQUE KEY `uq_usuarios_email` (`email_vigente`),',
        'ADD KEY `idx_usuarios_usuario` (`usuario`),',
        'ADD KEY `idx_usuarios_email` (`email`),',
        'ADD KEY `idx_usuarios_parent_user` (`parent_user_id`),',
        'ADD KEY `idx_usuarios_deleted_at` (`deleted_at`),',
        'ADD CONSTRAINT `fk_usuarios_parent_user` FOREIGN KEY (`parent_user_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,',
        'ADD CONSTRAINT `fk_usuarios_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,',
        'ADD CONSTRAINT `fk_usuarios_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
      ].join('\n'),
    );

    // --- Bloqueo optimista y codigo de empleado -------------------------------
    await queryRunner.query(
      [
        'ALTER TABLE `empleado`',
        'ADD COLUMN `codigo` VARCHAR(50) NULL AFTER `puesto_id`,',
        // `version` la incrementa TypeORM en cada UPDATE. Si dos peticiones han leido
        // la misma version, la segunda actualiza cero filas y el servicio puede
        // responder 409 en vez de pisar el cambio de la primera.
        'ADD COLUMN `version` INT NOT NULL DEFAULT 0,',
        'ADD COLUMN `codigo_vigente` VARCHAR(50) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `codigo`, NULL)) STORED',
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'ALTER TABLE `empleado`',
        // El UNIQUE es por empresa, no global: el codigo "A-001" puede existir en dos
        // empresas distintas.
        'ADD UNIQUE KEY `uq_empleado_codigo` (`empresa_id`, `codigo_vigente`),',
        'ADD KEY `idx_empleado_codigo` (`codigo`)',
      ].join('\n'),
    );

    // --- Cifrado de datos sensibles --------------------------------------------
    //
    // `numero_documento` pasa a guardar el texto cifrado y el indice ciego pasa a
    // `documento_indice`. El UNIQUE y el filtro por documento exacto se apoyan en el
    // indice, porque el cifrado lleva un IV aleatorio y dos documentos iguales nunca
    // producen el mismo texto cifrado.
    await queryRunner.query(
      [
        'ALTER TABLE `persona`',
        // 255 es de sobra: el documento mas largo (50 caracteres) cifrado en AES-256-GCM',
        // y en base64 ocupa unos 110. Antes era VARCHAR(50).',
        'MODIFY COLUMN `numero_documento` VARCHAR(255) NOT NULL,',
        'ADD COLUMN `documento_indice` CHAR(64) NULL AFTER `numero_documento`,',
        'ADD COLUMN `documento_indice_vigente` CHAR(64) GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `documento_indice`, NULL)) STORED',
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'ALTER TABLE `persona`',
        'DROP INDEX `uq_persona_documento`,',
        'ADD UNIQUE KEY `uq_persona_documento` (`documento_indice_vigente`),',
        // El indice sobre el documento cifrado se quita: cada fila tiene un IV distinto,
        // asi que no sirve para localizar nada y solo engorda el arbol. El indice util
        // es el del valor derivado, que si responde a igualdad.
        'DROP INDEX `idx_persona_numero_documento`,',
        'ADD KEY `idx_persona_documento_indice` (`documento_indice`),',
        // Y se va la columna generada antigua, que es lo que hay que acordarse de hacer:
        // quitar el indice que la sostenia NO la borra. Se queda viva, sigue derivandose
        // de `numero_documento` y, al pasar esa columna de VARCHAR(50) a VARCHAR(255)
        // con texto cifrado dentro, revienta con "Data too long for column" en cuanto se
        // escribe una fila.
        'DROP COLUMN `documento_vigente`',
      ].join('\n'),
    );

    // Salario e IBAN se anaden a `empleado` porque es donde viven: el salario de una
    // persona es el de su contratacion en esa empresa, no un atributo de la persona.
    // El IBAN no lleva UNIQUE porque no es una regla del negocio: dos empleados pueden
    // compartir una cuenta conjunta, y unico lo prohibiria sin que nadie lo pidiera.
    await queryRunner.query(
      [
        'ALTER TABLE `empleado`',
        // TEXT y no VARCHAR porque el cifrado en base64 no tiene una longitud util que
        // valga la pena prefijar, y porque las columnas TEXT no se indexan: no hace
        // falta, el indice va sobre el indice ciego.
        'ADD COLUMN `salario_cifrado` TEXT NULL AFTER `fecha_fin`,',
        'ADD COLUMN `iban_cifrado` TEXT NULL AFTER `salario_cifrado`,',
        'ADD COLUMN `iban_indice` CHAR(64) NULL AFTER `iban_cifrado`',
      ].join('\n'),
    );

    await queryRunner.query(
      [
        'ALTER TABLE `empleado`',
        'ADD KEY `idx_empleado_iban` (`empresa_id`, `iban_indice`),',
        // Si hay IBAN cifrado, tiene que haber indice ciego: sin el no se podria
        // localizar, y quedaria un dato cifrado inaccesible.
        'ADD CONSTRAINT `ck_empleado_iban` CHECK (`iban_cifrado` IS NULL OR `iban_indice` IS NOT NULL)',
      ].join('\n'),
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Irreversible a proposito. Devolver el documento a texto claro exigiria la clave de
    // la aplicacion, que una migracion no tiene. Un `down` que "funcionara" dejaria
    // datos cifrados en columnas declaradas como texto plano, y el siguiente fallo
    // apareceria mucho despues y en un sitio peor. Quien necesite tirar atras, restaura
    // una copia previa a esta migracion.
    throw new Error(
      'Irreversible: deja el documento de identidad cifrado y no puede volver a texto claro sin DATA_ENCRYPTION_KEY',
    );
  }
}
