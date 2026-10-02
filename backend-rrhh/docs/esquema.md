# Esquema de base de datos

Multi-tenant sobre MySQL 8. La fuente de verdad del esquema son las migraciones en
`src/database/migrations/`. Las entidades de TypeORM son un mapeo de lectura; nunca
deben crear ni alterar tablas.

## `synchronize` debe permanecer en `false`

`crearOpcionesDataSource()` fija `synchronize: false`. No es una preferencia: si se
activa, TypeORM aplicaría el diff que calcula contra el esquema y **borraría las
llaves foráneas compuestas de `empleado`**, que son la garantía de que un empleado
no puede recibir un departamento o puesto de otra empresa. El esquema se modifica
solo con migraciones.

## Migraciones

| Migración                                            | Contenido                             |
| ---------------------------------------------------- | ------------------------------------- |
| `1790726400000-AnadirIdAUsuarios`                    | PK `id` en `usuarios` y `email` único |
| `1790730000000-EmpresasPersonasDepartamentosPuestos` | Catálogos base                        |
| `1790733600000-AmpliarUsuariosYCreaEmpleado`         | `empleado` y FKs compuestas           |
| `1790737200000-RbacRolesPermisosUsuarioEmpresa`      | RBAC y membresías                     |
| `1790740800000-SeedRolesYPermisos`                   | Seeds idempotentes                    |
| `1790744400000-RefreshTokenYAuditoria`               | Seguridad y auditoría                 |
| `1790748000000-AccionCambioEmpresa`                   | `CAMBIO_EMPRESA` en el CHECK de `accion` |
| `1790752000000-JerarquiaYCamposSensibles`            | Jerarquía de usuarios, versión y datos sensibles |
| `1790755600000-PermisoEmpleadoSensible`              | Permiso de lectura de salario e IBAN              |

```bash
npm run migration:show   # estado
npm run migration:run    # aplicar
npm run migration:revert # deshacer la última
```

`AccionCambioEmpresa` no edita `RefreshTokenYAuditoria` aunque las dos toquen el mismo
CHECK: la segunda ya está aplicada en las bases existentes, y modificar una migración
que ya corrió no la vuelve a ejecutar. El CHECK se quedaría como en el código y no
como en la base.

`JerarquiaYCamposSensibles` es la excepción a "no edites migraciones aplicadas": se
corrigió dos veces **antes** de darse por buena, con la base de desarrollo recreada
entre intento e intento. Una vez aplicada en un entorno compartido, ya no se toca: se
escribe una migración nueva.

`PermisoEmpleadoSensible` es justamente eso: el permiso `empleado.sensible.leer` se
añade en una migración nueva y no editando `SeedRolesYPermisos`. Si se hubiera editado
el seed, la base ya montada no lo habría recibido nunca, porque TypeORM no vuelve a
ejecutar una migración ya aplicada, y el permiso solo existiría en las bases creadas
desde cero.

## Datos sensibles: cifrado en reposo

`JerarquiaYCamposSensibles` cambia el significado de tres columnas. Antes guardaban un
valor usable (un documento, un IBAN); ahora guardan texto cifrado:

| Columna                    | Contenido                                  |
| -------------------------- | ------------------------------------------ |
| `persona.numero_documento` | `v1:<iv>:<tag>:<cifrado>` en AES-256-GCM   |
| `persona.documento_indice` | HMAC-SHA256 del documento, para buscar      |
| `empleado.salario_cifrado` | `v1:<iv>:<tag>:<cifrado>`                   |
| `empleado.iban_cifrado`    | `v1:<iv>:<tag>:<cifrado>`                   |
| `empleado.iban_indice`     | HMAC-SHA256 del IBAN, con su propio contexto |

El IV es aleatorio en cada cifrado, así que dos filas con el mismo documento producen
textos distintos. Por eso la igualdad y el UNIQUE no pueden ir contra la columna
cifrada: van contra el índice, que es determinista.

**Consecuencia sobre las búsquedas**: `numero_documento LIKE '%123%'` deja de
funcionar y no debe intentarse. Sobre texto cifrado no hay fragmento que buscar, y una
consulta así devuelve cero en silencio, que es peor que un error. Lo que hay son
filtros **exactos** por `numero_documento` e `iban`, que calculan el índice y van a su
columna. El `LIKE` sobre nombre y apellidos sigue siendo válido: no están cifrados.

### Backfill obligatorio tras aplicar la migración

Cambiar el tipo de una columna no convierte lo que ya hay dentro. Hay que ejecutar:

```bash
npm run cifrar-datos
```

Cifra las filas que quedaron en claro, es idempotente (una segunda pasada convierte 0
filas) y avisa de los documentos duplicados, que no puede resolver solo. **Sin este
paso, la aplicación arranca y el listado de documentos devuelve cero**, sin error
visible: el índice nunca se calculó.

Las entidades y el servicio comparten los contextos de cifrado mediante
`CONTEXTO_DOCUMENTO_PERSONA` y `CONTEXTO_IBAN_EMPLEADO` en `common/cifrado.service.ts`.
`cifrar-datos.ts` importa esas constantes y no repite los literales: si el contexto
cambia y el script no lo sigue, cifra con un índice que el servicio ya no busca.

### La auditoría no guarda datos en claro

Los servicios auditan la misma forma que devuelven por la API, y esa forma viene
descifrada. `AuditoriaService.auditar()` pasa `datos_antes` y `datos_despues` por
`ocultarSensibles()` (`common/../auditoria/redaccion.ts`), que sustituye por `[oculto]`
las claves sensibles y sus valores anidados.

El ocultamiento está en la auditoría y no en cada servicio a propósito: es una
propiedad de la tabla, y si dependiera de que cada servicio se acuerde, bastaría uno
nuevo que audite sin hacerlo para volver a filtrar.

`ocultarSensibles()` recorre el camino actual, no todo lo ya visitado. La diferencia
importa: si dos campos apuntan al mismo objeto, ese objeto se copia dos veces, y solo un
ciclo de verdad se marca como `[circular]`. Con un `WeakSet` de "todo lo visto"
—que es la solución que aparece en casi cualquier ejemplo— la segunda copia salía como
`[circular]`, y en la auditoría un campo perdía su contenido sin motivo aparente.

## Retención: `auditoria` y `refresh_token`

Ninguna de las dos tiene tope de filas. La limpieza es el script `npm run mantener`, y
por defecto **cuenta sin borrar**; hace falta `--aplicar` para que borre.

Dos plazos distintos, porque no son lo mismo:

| Tabla            | Variable                | Por defecto | Razón                                        |
| ---------------- | ----------------------- | ----------- | -------------------------------------------- |
| `refresh_token`  | `RETENCION_TOKENS_DIAS`  | 30          | Caducado, no vale para nada                  |
| `auditoria`      | `RETENCION_AUDITORIA_DIAS` | 365       | Es histórico: responde de cambios antiguos   |

Un valor no numérico o negativo se descarta con un aviso y se usa el valor por defecto.
El motivo es concreto: `INTERVAL -5 DAY` es una fecha futura, y `DELETE ... WHERE
creado_en < futuro` se lleva la tabla entera.

`auditoria` no tiene `ON DELETE CASCADE` sobre `empresa` ni `usuarios`, y no debería
tenerlo: el registro se conserva precisamente cuando el recurso ya no está. Por eso la
limpieza es explícita y no una cascada que un borrado de usuario dispare sin querer.

## Concurrencia: `empleado.version`

`empleado.version` es un `@VersionColumn`. Dos peticiones concurrentes que actualizan
la misma fila se resuelven así:

- Si el cliente manda `version`, se compara con la de la fila y una discrepancia es un
  409, sin escribir nada.
- Si no la manda, el `save()` incluye la versión en el `WHERE`, y si otra escritura ha
  cambiado la fila, TypeORM lanza `OptimisticLockVersionMismatchError`. Se traduce a
  409 en `empleado.service.ts`; sin capturar respondería 500, que dice "fallo del
  servidor" cuando es un conflicto del cliente.

## Jerarquía de usuarios

`usuarios.parent_user_id` es una autorreferencia con `ON DELETE RESTRICT`: no se puede
borrar un jefe dejando hijos colgando.

**La base no puede detectar ciclos**: una FK no recorre la autorreferencia y un CHECK
no puede consultar la propia tabla mientras se escribe. La prevención es de
aplicación, en `UsersService.puedeColgarseDe()`, que sube desde el padre propuesto
hasta la raíz y rechaza si aparece el usuario que se quería colgar. El caso que se
escapa al `if (a === b)` es el indirecto: si A es superior de B y B de C, A no puede
coger a C como superior.

`descendientes()` va como SQL directo porque esta versión de TypeORM no expone CTE. Sus
marcadores son **posicionales** (`?`) y no con nombre: `DataSource.query()` entrega la
cadena tal cual al driver, que no traduce `:nombre` como sí hace `QueryBuilder`, y el
fallo aparece como un error de sintaxis a kilómetros de la causa.

El UNIQUE de `usuario` y de `email` está sobre las columnas generadas
`usuario_vigente` y `email_vigente`, no sobre las columnas base: así un nombre liberado
por una baja se puede volver a asignar.

## `database-rrhh/schema_mysql.sql`

Volcado generado con `mysqldump`, no la fuente de verdad. Sirve para levantar una base
vacía sin ejecutar migraciones: el `Dockerfile` de ese directorio lo copia a
`docker-entrypoint-initdb.d`.

Además del esquema incluye las migraciones marcadas como aplicadas y el vocabulario
RBAC (roles, permisos y su asignación). Las dos cosas son necesarias: sin las filas de
`migrations`, TypeORM intentaría aplicar migraciones cuyas tablas ya existirían; sin
los roles, una base recién creada no tendría ningún rol que asignar y el login no
podría completarse.

No incluye `typeorm_metadata`, porque solo la usa `synchronize: true`, que el proyecto
tiene desactivado, y la crea `asegurarTablaMetadata()` cuando hacen falta migraciones.

## `typeorm_metadata`

Aiven tiene `sql_require_primary_key = ON`, pero el DDL que TypeORM genera para
`typeorm_metadata` no lleva PRIMARY KEY (solo lo agrega para el driver Spanner).
Por eso `asegurarTablaMetadata()` la crea con una PK propia antes de migrar, y
`DB_RUN_MIGRATIONS=false` evita que la aplicación intente hacerlo al arrancar.

Además, `sincronizarColumnasGeneradas()` registra la expresión de cada columna
GENERATED. Es necesario porque TypeORM no puede leer esa expresión desde
`information_schema` (MySQL la devuelve reformateada: `if((... is null),...,NULL)`
frente a `IF(... IS NULL, ..., NULL)`), así que la busca en `typeorm_metadata` con
`type = 'GENERATED_COLUMN'`. Sin esas filas el esquema se vería como diferente.

## Por qué el diff del schema builder no llega a cero

`createSchemaBuilder().log()` reporta 2 consultas, ambas sobre las FKs compuestas:

```
ALTER TABLE `empleado` DROP FOREIGN KEY `fk_empleado_departamento`
ALTER TABLE `empleado` DROP FOREIGN KEY `fk_empleado_puesto`
```

Es un límite de TypeORM, no un error de mapeo. `empleado.empresa_id` participa en
tres llaves foráneas a la vez:

- `fk_empleado_empresa (empresa_id)` → `empresa(id)`
- `fk_empleado_departamento (empresa_id, departamento_id)` → `departamento(empresa_id, id)`
- `fk_empleado_puesto (empresa_id, puesto_id)` → `puesto(empresa_id, id)`

TypeORM no admite que una columna participe en más de una relación, y las FKs
compuestas no son navegables con `@ManyToOne` sin duplicar la columna. Por eso
`departamento_id` y `puesto_id` son columnas simples en la entidad.

**El aislamiento sigue intacto**: lo aplica MySQL, no la aplicación. Para leer el
departamento o puesto se usa `QueryBuilder`:

```ts
const filas = await repo
  .createQueryBuilder('e')
  .innerJoin(
    'departamento',
    'd',
    'd.id = e.departamento_id AND d.empresa_id = e.empresa_id',
  )
  .where('e.empresa_id = :empresaId', { empresaId })
  .getMany();
```

El `AND d.empresa_id = e.empresa_id` es buena práctica aunque la FK ya lo impida:
evita que un JOIN future toriga los datos de otra empresa.

Las entidades conservadoras de esa garantía son `departamento` y `puesto`, que
declaran `uq_departamento_empresa_id` y `uq_puesto_empresa_id` como destino de las
referencias compuestas.

## Columnas GENERATED y soft delete

`deleted_at` no basta para liberar un valor único. Varias tablas calculan una
columna que devuelve el valor clave mientras la fila está viva y `NULL` cuando no:

| Tabla                    | Columna                   | Expresión                                                         |
| ------------------------ | ------------------------- | ----------------------------------------------------------------- |
| `empresa`                | `codigo_vigente`          | `IF(deleted_at IS NULL, codigo, NULL)`                            |
| `departamento`, `puesto` | `codigo_vigente`          | `IF(deleted_at IS NULL, codigo, NULL)`                            |
| `permiso`, `rol`         | `codigo_vigente`          | `IF(deleted_at IS NULL, codigo, NULL)`                            |
| `usuario`                | `usuario_vigente`         | `IF(deleted_at IS NULL, usuario, NULL)`                           |
| `usuario`                | `email_vigente`           | `IF(deleted_at IS NULL, email, NULL)`                             |
| `empleado`               | `codigo_vigente`          | `IF(deleted_at IS NULL, codigo, NULL)`                            |
| `empleado`               | `empresa_persona_vigente` | `IF(deleted_at IS NULL, CONCAT(empresa_id,'-',persona_id), NULL)` |
| `usuario_empresa`        | `empresa_usuario_vigente` | `IF(deleted_at IS NULL, CONCAT(empresa_id,'-',usuario_id), NULL)` |

`persona` ya no tiene `documento_vigente`: `numero_documento` pasó a contener texto
cifrado, y una columna que compara el documento en claro sobre un dato cifrado daría
siempre `NULL`, es decir, nunca penalizaría el UNIQUE. En su lugar están
`documento_indice` y `documento_indice_vigente`, calculadas sobre el índice.

MySQL admite varios `NULL` en un índice UNIQUE, así que el valor queda reservado
solo entre filas vivas y se puede reutilizar tras un soft delete.

Las entidades las declaran con `insert: false`, `update: false`, `select: false`,
`asExpression` y `generatedType: 'STORED'`. El `asExpression` no es opcional: sin él la
entidad describe una columna que no dice lo que dice la base, y el diff contra el
esquema propone cambios que no existen.

## Precisión de timestamps

El esquema usa `datetime(3)`. `@UpdateDateColumn` ignora `precision` y genera
`CURRENT_TIMESTAMP(6)`, así que las entidades usan `@Column` con dos campos
separados:

```ts
@Column({
  name: 'updated_at',
  type: 'datetime',
  precision: 3,
  default: () => 'CURRENT_TIMESTAMP(3)',
  onUpdate: 'CURRENT_TIMESTAMP(3)',
})
updated_at: Date;
```

## Nombres de índices y llaves foráneas

Las migraciones usan nombres descriptivos (`fk_empresa_created_by`,
`idx_empleado_empresa`). TypeORM compararía por sus nombres autogenerados
(`FK_9fdb…`) y proponía borrar y recrear los 33 objetos. Las entidades los declaran
con `@Index('nombre_real', [...])` y `foreignKeyConstraintName` en cada
`@JoinColumn`.

## Nombres de columnas

Las entidades usan nombres de snake_case en inglés (`usuario`, `activo`,
`password_hash`) porque el código de negocio ya está escrito así. Renombrarlas
implicaría migraciones y traducción de toda la capa de servicios.
