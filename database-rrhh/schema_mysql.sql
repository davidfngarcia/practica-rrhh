-- ---------------------------------------------------------------------------
-- Esquema de la base de datos de RRHH (MySQL 8.0).
--
-- Generado con `npm run esquema:dump`. El DDL sale de `SHOW CREATE TABLE` de cada
-- tabla, mas el vocabulario RBAC y las migraciones marcadas como aplicadas.
--
-- Este fichero NO es la fuente de verdad: esa son las migraciones de
-- `backend-rrhh/src/database/migrations`. Existe para levantar una base vacia sin
-- ejecutar migraciones a mano, que es lo que hace el `Dockerfile` de este directorio al
-- copiarlo a `docker-entrypoint-initdb.d`.
--
-- Si cambias una migracion, vuelve a ejecutar `npm run esquema:dump` en lugar de editarlo
-- a mano: si no, acaba describiendo un esquema que no existe en ninguna parte.
--
-- `persona.numero_documento`, `empleado.salario_cifrado` e `empleado.iban_cifrado`
-- guardan texto cifrado (AES-256-GCM). Los localiza el indice HMAC de la fila de al lado,
-- no una busqueda por texto. Ver `backend-rrhh/docs/esquema.md`.
--
-- Uso: mysql -u <usuario> -p < schema_mysql.sql
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `practica_rrhh`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `practica_rrhh`;

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

DROP TABLE IF EXISTS `auditoria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auditoria` (
  `id` char(36) NOT NULL,
  `empresa_id` char(36) DEFAULT NULL,
  `usuario_id` char(36) DEFAULT NULL,
  `accion` varchar(50) NOT NULL,
  `entidad` varchar(50) NOT NULL,
  `entidad_id` char(36) DEFAULT NULL,
  `datos_antes` json DEFAULT NULL,
  `datos_despues` json DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_auditoria_empresa_fecha` (`empresa_id`,`creado_en`),
  KEY `idx_auditoria_usuario_fecha` (`usuario_id`,`creado_en`),
  KEY `idx_auditoria_entidad` (`entidad`,`entidad_id`),
  KEY `idx_auditoria_fecha` (`creado_en`),
  CONSTRAINT `fk_auditoria_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_auditoria_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_auditoria_accion` CHECK ((`accion` in (_utf8mb4'CREAR',_utf8mb4'ACTUALIZAR',_utf8mb4'ELIMINAR',_utf8mb4'LOGIN',_utf8mb4'LOGOUT',_utf8mb4'LOGIN_FALLIDO',_utf8mb4'CAMBIO_ROL',_utf8mb4'CAMBIO_PERMISOS',_utf8mb4'CAMBIO_EMPRESA')))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `departamento`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `departamento` (
  `id` char(36) NOT NULL,
  `empresa_id` char(36) NOT NULL,
  `codigo` varchar(50) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `codigo_vigente` varchar(50) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_departamento_empresa_id` (`empresa_id`,`id`),
  UNIQUE KEY `uq_departamento_codigo` (`empresa_id`,`codigo_vigente`),
  KEY `idx_departamento_codigo` (`codigo`),
  KEY `idx_departamento_empresa_nombre` (`empresa_id`,`nombre`),
  KEY `idx_departamento_created_by` (`created_by`),
  KEY `idx_departamento_updated_by` (`updated_by`),
  CONSTRAINT `fk_departamento_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_departamento_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_departamento_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_departamento_activo` CHECK ((`activo` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `empleado`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `empleado` (
  `id` char(36) NOT NULL,
  `empresa_id` char(36) NOT NULL,
  `persona_id` char(36) NOT NULL,
  `departamento_id` char(36) DEFAULT NULL,
  `puesto_id` char(36) DEFAULT NULL,
  `codigo` varchar(50) DEFAULT NULL,
  `tipo_contrato` varchar(20) NOT NULL DEFAULT 'PLANTA',
  `fecha_ingreso` date NOT NULL,
  `fecha_fin` date DEFAULT NULL,
  `salario_cifrado` text,
  `iban_cifrado` text,
  `iban_indice` char(64) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `empresa_persona_vigente` varchar(80) GENERATED ALWAYS AS (if((`deleted_at` is null),concat(`empresa_id`,_utf8mb4'-',`persona_id`),NULL)) STORED,
  `version` int NOT NULL DEFAULT '0',
  `codigo_vigente` varchar(50) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_empleado_empresa_persona` (`empresa_persona_vigente`),
  UNIQUE KEY `uq_empleado_codigo` (`empresa_id`,`codigo_vigente`),
  KEY `idx_empleado_empresa` (`empresa_id`),
  KEY `idx_empleado_persona` (`persona_id`),
  KEY `idx_empleado_departamento` (`departamento_id`),
  KEY `idx_empleado_puesto` (`puesto_id`),
  KEY `idx_empleado_fecha_ingreso` (`fecha_ingreso`),
  KEY `idx_empleado_created_by` (`created_by`),
  KEY `idx_empleado_updated_by` (`updated_by`),
  KEY `fk_empleado_departamento` (`empresa_id`,`departamento_id`),
  KEY `fk_empleado_puesto` (`empresa_id`,`puesto_id`),
  KEY `idx_empleado_codigo` (`codigo`),
  KEY `idx_empleado_iban` (`empresa_id`,`iban_indice`),
  CONSTRAINT `fk_empleado_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_empleado_departamento` FOREIGN KEY (`empresa_id`, `departamento_id`) REFERENCES `departamento` (`empresa_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_empleado_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_empleado_persona` FOREIGN KEY (`persona_id`) REFERENCES `persona` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_empleado_puesto` FOREIGN KEY (`empresa_id`, `puesto_id`) REFERENCES `puesto` (`empresa_id`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_empleado_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_empleado_activo` CHECK ((`activo` in (0,1))),
  CONSTRAINT `ck_empleado_fechas` CHECK (((`fecha_fin` is null) or (`fecha_fin` >= `fecha_ingreso`))),
  CONSTRAINT `ck_empleado_iban` CHECK (((`iban_cifrado` is null) or (`iban_indice` is not null))),
  CONSTRAINT `ck_empleado_tipo_contrato` CHECK ((`tipo_contrato` in (_utf8mb4'SERVICIOS',_utf8mb4'PLANTA',_utf8mb4'CONTRATO',_utf8mb4'PRACTICAS',_utf8mb4'TEMPORAL')))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `empresa`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `empresa` (
  `id` char(36) NOT NULL,
  `codigo` varchar(50) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `razon_social` varchar(200) DEFAULT NULL,
  `nombre_comercial` varchar(150) DEFAULT NULL,
  `identificacion_tributaria` varchar(64) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `codigo_vigente` varchar(50) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_empresa_codigo` (`codigo_vigente`),
  KEY `idx_empresa_codigo` (`codigo`),
  KEY `idx_empresa_nombre` (`nombre`),
  KEY `idx_empresa_created_by` (`created_by`),
  KEY `idx_empresa_updated_by` (`updated_by`),
  CONSTRAINT `fk_empresa_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_empresa_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_empresa_activo` CHECK ((`activo` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `timestamp` bigint NOT NULL,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `permiso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `permiso` (
  `id` char(36) NOT NULL,
  `codigo` varchar(100) NOT NULL,
  `modulo` varchar(50) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `codigo_vigente` varchar(100) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_permiso_codigo` (`codigo_vigente`),
  KEY `idx_permiso_codigo` (`codigo`),
  KEY `idx_permiso_modulo` (`modulo`),
  KEY `idx_permiso_created_by` (`created_by`),
  KEY `idx_permiso_updated_by` (`updated_by`),
  CONSTRAINT `fk_permiso_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_permiso_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_permiso_activo` CHECK ((`activo` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `persona`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `persona` (
  `id` char(36) NOT NULL,
  `tipo_documento` varchar(20) NOT NULL,
  `numero_documento` varchar(255) NOT NULL,
  `documento_indice` char(64) DEFAULT NULL,
  `nombres` varchar(100) NOT NULL,
  `apellidos` varchar(100) NOT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  `genero` char(1) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `documento_indice_vigente` char(64) GENERATED ALWAYS AS (if((`deleted_at` is null),`documento_indice`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_persona_documento` (`documento_indice_vigente`),
  KEY `idx_persona_nombres` (`nombres`),
  KEY `idx_persona_apellidos` (`apellidos`),
  KEY `idx_persona_created_by` (`created_by`),
  KEY `idx_persona_updated_by` (`updated_by`),
  KEY `idx_persona_documento_indice` (`documento_indice`),
  CONSTRAINT `fk_persona_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_persona_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_persona_activo` CHECK ((`activo` in (0,1))),
  CONSTRAINT `ck_persona_genero` CHECK (((`genero` is null) or (`genero` in (_utf8mb4'M',_utf8mb4'F',_utf8mb4'O')))),
  CONSTRAINT `ck_persona_tipo_documento` CHECK ((`tipo_documento` in (_utf8mb4'CC',_utf8mb4'CE',_utf8mb4'NIT',_utf8mb4'PASAPORTE')))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `puesto`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `puesto` (
  `id` char(36) NOT NULL,
  `empresa_id` char(36) NOT NULL,
  `codigo` varchar(50) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `codigo_vigente` varchar(50) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_puesto_empresa_id` (`empresa_id`,`id`),
  UNIQUE KEY `uq_puesto_codigo` (`empresa_id`,`codigo_vigente`),
  KEY `idx_puesto_codigo` (`codigo`),
  KEY `idx_puesto_empresa_nombre` (`empresa_id`,`nombre`),
  KEY `idx_puesto_created_by` (`created_by`),
  KEY `idx_puesto_updated_by` (`updated_by`),
  CONSTRAINT `fk_puesto_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_puesto_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_puesto_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_puesto_activo` CHECK ((`activo` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `refresh_token`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `refresh_token` (
  `id` char(36) NOT NULL,
  `usuario_id` char(36) NOT NULL,
  `empresa_id` char(36) DEFAULT NULL,
  `token_hash` char(64) NOT NULL,
  `familia` char(36) NOT NULL,
  `expira_en` datetime(3) NOT NULL,
  `revocado_at` datetime(3) DEFAULT NULL,
  `revocado_motivo` varchar(100) DEFAULT NULL,
  `reemplazado_por` char(36) DEFAULT NULL,
  `ultimo_uso` datetime(3) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `creado_en` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_token_hash` (`token_hash`),
  KEY `idx_refresh_token_familia` (`familia`),
  KEY `idx_refresh_token_usuario_expira` (`usuario_id`,`expira_en`),
  KEY `idx_refresh_token_empresa` (`empresa_id`),
  KEY `idx_refresh_token_expira` (`expira_en`),
  KEY `idx_refresh_token_reemplazado_por` (`reemplazado_por`),
  CONSTRAINT `fk_refresh_token_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_refresh_token_reemplazado_por` FOREIGN KEY (`reemplazado_por`) REFERENCES `refresh_token` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_refresh_token_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_refresh_token_revocado` CHECK (((`revocado_at` is null) or (`revocado_motivo` is not null)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `rol`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rol` (
  `id` char(36) NOT NULL,
  `codigo` varchar(50) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `es_sistema` tinyint(1) NOT NULL DEFAULT '0',
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `codigo_vigente` varchar(50) GENERATED ALWAYS AS (if((`deleted_at` is null),`codigo`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rol_codigo` (`codigo_vigente`),
  KEY `idx_rol_codigo` (`codigo`),
  KEY `idx_rol_nombre` (`nombre`),
  KEY `idx_rol_created_by` (`created_by`),
  KEY `idx_rol_updated_by` (`updated_by`),
  CONSTRAINT `fk_rol_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_rol_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_rol_activo` CHECK ((`activo` in (0,1))),
  CONSTRAINT `ck_rol_es_sistema` CHECK ((`es_sistema` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `rol_permiso`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rol_permiso` (
  `rol_id` char(36) NOT NULL,
  `permiso_id` char(36) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  PRIMARY KEY (`rol_id`,`permiso_id`),
  KEY `idx_rol_permiso_permiso` (`permiso_id`),
  KEY `idx_rol_permiso_created_by` (`created_by`),
  CONSTRAINT `fk_rol_permiso_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_rol_permiso_permiso` FOREIGN KEY (`permiso_id`) REFERENCES `permiso` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_rol_permiso_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `usuario_empresa`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_empresa` (
  `id` char(36) NOT NULL,
  `empresa_id` char(36) NOT NULL,
  `usuario_id` char(36) NOT NULL,
  `rol_id` char(36) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `empresa_usuario_vigente` varchar(80) GENERATED ALWAYS AS (if((`deleted_at` is null),concat(`empresa_id`,_utf8mb4'-',`usuario_id`),NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuario_empresa` (`empresa_usuario_vigente`),
  KEY `idx_usuario_empresa_empresa` (`empresa_id`),
  KEY `idx_usuario_empresa_usuario` (`usuario_id`),
  KEY `idx_usuario_empresa_rol` (`rol_id`),
  KEY `idx_usuario_empresa_empresa_rol` (`empresa_id`,`rol_id`),
  KEY `idx_usuario_empresa_created_by` (`created_by`),
  KEY `idx_usuario_empresa_updated_by` (`updated_by`),
  CONSTRAINT `fk_usuario_empresa_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_usuario_empresa_empresa` FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_usuario_empresa_rol` FOREIGN KEY (`rol_id`) REFERENCES `rol` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_usuario_empresa_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_usuario_empresa_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `ck_usuario_empresa_activo` CHECK ((`activo` in (0,1)))
);
/*!40101 SET character_set_client = @saved_cs_client */;

DROP TABLE IF EXISTS `usuarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `usuario` varchar(128) NOT NULL,
  `password_hash` varchar(128) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `parent_user_id` char(36) DEFAULT NULL,
  `id` char(36) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `ultimo_acceso` datetime(3) DEFAULT NULL,
  `deleted_at` datetime(3) DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `updated_by` char(36) DEFAULT NULL,
  `usuario_vigente` varchar(128) GENERATED ALWAYS AS (if((`deleted_at` is null),`usuario`,NULL)) STORED,
  `email_vigente` varchar(150) GENERATED ALWAYS AS (if((`deleted_at` is null),`email`,NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_usuario` (`usuario_vigente`),
  UNIQUE KEY `uq_usuarios_email` (`email_vigente`),
  KEY `idx_usuarios_usuario` (`usuario`),
  KEY `idx_usuarios_email` (`email`),
  KEY `idx_usuarios_parent_user` (`parent_user_id`),
  KEY `idx_usuarios_deleted_at` (`deleted_at`),
  KEY `fk_usuarios_created_by` (`created_by`),
  KEY `fk_usuarios_updated_by` (`updated_by`),
  CONSTRAINT `fk_usuarios_created_by` FOREIGN KEY (`created_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_usuarios_parent_user` FOREIGN KEY (`parent_user_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_usuarios_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
/*!40101 SET character_set_client = @saved_cs_client */;


/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Las migraciones se marcan como aplicadas a proposito: este fichero crea el esquema ya
-- completo. Si `migrations` quedara vacio, TypeORM intentaria aplicar encima migraciones
-- cuyas tablas ya existirian y la instalacion fallaria en la primera.
INSERT INTO `migrations` (`timestamp`, `name`) VALUES
(1790726400000,'AnadirIdAUsuarios1790726400000'),
(1790730000000,'EmpresasPersonasDepartamentosPuestos1790730000000'),
(1790733600000,'AmpliarUsuariosYCreaEmpleado1790733600000'),
(1790737200000,'RbacRolesPermisosUsuarioEmpresa1790737200000'),
(1790740800000,'SeedRolesYPermisos1790740800000'),
(1790744400000,'RefreshTokenYAuditoria1790744400000'),
(1790748000000,'AccionCambioEmpresa1790748000000'),
(1790752000000,'JerarquiaYCamposSensibles1790752000000'),
(1790755600000,'PermisoEmpleadoSensible1790755600000');

-- Vocabulario RBAC: roles, permisos y su asignacion. Sin estas filas una base recien
-- creada no tendria ningun rol que asignar y el login no podria completarse. Los datos
-- de prueba de la aplicacion no van aqui: los crea `npm run semilla`.

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

LOCK TABLES `rol` WRITE;
/*!40000 ALTER TABLE `rol` DISABLE KEYS */;
INSERT INTO `rol` (`id`, `codigo`, `nombre`, `descripcion`, `es_sistema`, `activo`, `created_by`, `updated_by`, `deleted_at`) VALUES
('b0000000-0000-4000-8000-000000000000','ADMIN_EMPRESA','Administrador de empresa','Control total sobre los datos de su empresa',1,1,NULL,NULL,NULL),
('b0000000-0000-4000-8000-000000000001','RRHH','Recursos Humanos','Gestiona estructura, personal y catalogos de la empresa',1,1,NULL,NULL,NULL),
('b0000000-0000-4000-8000-000000000002','EMPLEADO','Empleado','Acceso de solo lectura a su empresa y a sus propios datos',1,1,NULL,NULL,NULL);
/*!40000 ALTER TABLE `rol` ENABLE KEYS */;
UNLOCK TABLES;
LOCK TABLES `permiso` WRITE;
/*!40000 ALTER TABLE `permiso` DISABLE KEYS */;
INSERT INTO `permiso` (`id`, `codigo`, `modulo`, `descripcion`, `activo`, `created_by`, `updated_by`, `deleted_at`) VALUES
('a0000000-0000-4000-8000-000000000000','empresa.leer','empresa','Consulta de empresa',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000001','empresa.crear','empresa','Creacion de empresa',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000002','empresa.actualizar','empresa','Actualizacion de empresa',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000003','empresa.eliminar','empresa','Eliminacion de empresa',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000004','departamento.leer','departamento','Consulta de departamento',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000005','departamento.crear','departamento','Creacion de departamento',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000006','departamento.actualizar','departamento','Actualizacion de departamento',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000007','departamento.eliminar','departamento','Eliminacion de departamento',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000008','puesto.leer','puesto','Consulta de puesto',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000009','puesto.crear','puesto','Creacion de puesto',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000010','puesto.actualizar','puesto','Actualizacion de puesto',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000011','puesto.eliminar','puesto','Eliminacion de puesto',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000012','persona.leer','persona','Consulta de persona',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000013','persona.crear','persona','Creacion de persona',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000014','persona.actualizar','persona','Actualizacion de persona',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000015','persona.eliminar','persona','Eliminacion de persona',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000016','empleado.leer','empleado','Consulta de empleado',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000017','empleado.crear','empleado','Creacion de empleado',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000018','empleado.actualizar','empleado','Actualizacion de empleado',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000019','empleado.eliminar','empleado','Eliminacion de empleado',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000020','usuario.leer','usuario','Consulta de usuario',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000021','usuario.crear','usuario','Creacion de usuario',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000022','usuario.actualizar','usuario','Actualizacion de usuario',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000023','usuario.eliminar','usuario','Eliminacion de usuario',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000024','rol.leer','rol','Consulta de rol',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000025','rol.crear','rol','Creacion de rol',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000026','rol.actualizar','rol','Actualizacion de rol',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000027','rol.eliminar','rol','Eliminacion de rol',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000028','auditoria.leer','auditoria','Consulta de auditoria',1,NULL,NULL,NULL),
('a0000000-0000-4000-8000-000000000029','empleado.sensible.leer','empleado','Consulta de salario e IBAN de los empleados',1,NULL,NULL,NULL);
/*!40000 ALTER TABLE `permiso` ENABLE KEYS */;
UNLOCK TABLES;
LOCK TABLES `rol_permiso` WRITE;
/*!40000 ALTER TABLE `rol_permiso` DISABLE KEYS */;
INSERT INTO `rol_permiso` (`rol_id`, `permiso_id`, `created_by`) VALUES
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000000',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000001',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000002',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000003',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000004',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000005',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000006',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000007',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000008',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000009',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000010',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000011',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000012',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000013',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000014',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000015',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000016',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000017',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000018',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000019',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000020',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000021',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000022',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000023',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000024',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000025',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000026',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000027',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000028',NULL),
('b0000000-0000-4000-8000-000000000000','a0000000-0000-4000-8000-000000000029',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000000',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000004',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000005',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000006',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000007',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000008',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000009',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000010',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000011',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000012',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000013',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000014',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000015',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000016',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000017',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000018',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000019',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000020',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000028',NULL),
('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000029',NULL),
('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000000',NULL),
('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000012',NULL),
('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000016',NULL);
/*!40000 ALTER TABLE `rol_permiso` ENABLE KEYS */;
UNLOCK TABLES;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
