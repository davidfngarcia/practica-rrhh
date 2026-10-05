# Fase 0: análisis del repositorio

Este documento es el paso previo a cualquier diseño. Recoge el stack real que usa el
repositorio, las convenciones que hay que seguir, lo que ya existe y se puede reutilizar,
lo que falta respecto a los requisitos, y las dependencias nuevas que se proposer.

**No se ha escrito código de producto a partir de este documento.** Las migraciones que ya
hay y el código que ya existe son la base; este texto explica qué se mantiene y qué se
añade.

Fuentes revisadas: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`,
`vitest.config.e2e.ts`, `.env.template`, `src/`, `test/`, `database-rrhh/`, las nueve
migraciones de `src/database/migrations/` y el volcado `schema_mysql.sql`.

## 1. Stack real

Todo lo que hay aquí se deduce de los ficheros del repositorio. **No se propone cambiar
nada de esta tabla.**

| Capa | Tecnología | Dónde se comprueba |
| --- | --- | --- |
| Lenguaje | TypeScript 6, `strict: true` | `tsconfig.json` |
| Resolución de módulos | `nodenext`, ESM estricto | `module: "nodenext"` |
| Framework | NestJS 12 | `@nestjs/core@^12.0.1` |
| Gestor de paquetes | npm 10, lockfile v3 | `package-lock.json` |
| Base de datos | MySQL 8, driver `mysql2` | `@nestjs/typeorm`, `data-source.ts` |
| ORM | TypeORM 1.1.1 | `typeorm@^1.1.1` |
| Migraciones | TypeORM CLI, 9 ficheros | `src/database/migrations/` |
| Validación | `class-validator` + `class-transformer` | `pipeValidacion()` en `common/errores.ts` |
| Autenticación | Passport + `@nestjs/jwt` | `auth/jwt.strategy.ts` |
| Hash de contraseñas | bcrypt, coste 10 | `auth/auth.service.ts` |
| Logging | pino + nestjs-pino + pino-http | `package.json`, módulo de aplicación |
| Pruebas | Vitest 4 + supertest | `vitest.config.ts`, `vitest.config.e2e.ts` |
| Documentación de API | `@nestjs/swagger` instalado | **sin configurar**: `main.ts` no lo monta |
| Lint y formato | oxlint + prettier | scripts `lint` y `format` |
| Contenedores | `database-rrhh/Dockerfile` | sin `docker-compose` |

### Dos desviaciones respecto al enunciado, y por qué se mantienen

- **bcrypt en lugar de Argon2id.** El enunciado admite bcrypt si es el estándar del
  proyecto. Está en `package.json` desde antes de este trabajo y ya se usa para sembrar y
  verificar. Cambiar a Argon2id obligaría a rehashear todas las contraseñas y a rehacer los
  58 chequeos de autenticación sin ganar nada en este punto.
- **Vitest en lugar de Jest.** Es el framework que ya usa el repositorio. El enunciado pide
  usar "el framework de pruebas del proyecto", y este es.

### Identificadores

El proyecto ya tiene convención propia y sigue la del enunciado: **UUID v7** en
`char(36)`. No se propone cambiar a `binary(16)`, que sería más eficiente, porque obliga a
convertir en las consultas y en los parámetros de JSON, y porque las nueve migraciones ya
aplicadas usan `char(36)`.

### Marcas de tiempo

El proyecto es **mixto**, y conviene saber cuál es cuál antes de escribir un DTO nuevo:

| Contexto | Columnas | Nota |
| --- | --- | --- |
| Entidades de negocio | `created_at`, `updated_at`, `deleted_at` | Coincide con el enunciado |
| `auditoria` y `refresh_token` | `creado_en`, `expira_en` | Castellano, por ser tablas de infraestructura |

En las entidades de negocio **no hay nada que decidir**: ya se usan los nombres en inglés
del enunciado, y una migración de renombrado no aportaría nada. El castellano aparece solo
en las columnas que ya se habían creado así en `RefreshTokenYAuditoria`, y ahí se quedan
porque renombrarlas no mejora nada y sí obliga a tocar índices y al histórico de auditoría.

La regla práctica: **las entidades nuevas siguen el inglés** (`created_at`, `updated_at`,
`deleted_at`), porque es lo que ya hacen las de negocio. Las tablas que se parezcan a
`auditoria` o `refresh_token` siguen el castellano.

## 2. Convenciones del proyecto

### Nombres de fichero

Minúsculas, con punto para separar la responsabilidad y guion dentro del nombre cuando el
elemento tiene más de una palabra:

```
persona.dto.ts          clase de entrada/salida de un dominio
empleado.controller.ts  controlador HTTP
refresh-token.entity.ts entidad con guion
generar-esquema.ts      script con verbo
```

Un módulo es una carpeta con `*.module.ts`, `*.controller.ts`, `*.service.ts` y
`*.dto.ts`. Las entidades no viven en su módulo: están todas en
`src/database/entities/`, porque TypeORM las carga desde `data-source.ts`.

### Tablas y columnas

Todo en `snake_case`: tablas `refresh_token`, `usuario_empresa`, `rol_permiso`; columnas
`numero_documento`, `salario_cifrado`, `created_at`.

La convención de marcas de tiempo es **mixta**, y conviene saberlo antes de tocar nada:

| Dónde | Columnas | Por qué |
| --- | --- | --- |
| Entidades de negocio | `created_at`, `updated_at`, `deleted_at` | Vienen del modelo original, en inglés |
| Infraestructura (`auditoria`, `refresh_token`) | `creado_en`, `expira_en` | Escritas como infraestructura, en castellano |

Unificarlo exigiría una migración que renombre columnas en las tablas de negocio y que
tocaría a la vez entidades, DTO, consultas y pruebas. No se hace sin una decisión
explícita: el nombre actual de las columnas de negocio coincide con lo que pedía el
brief, y renombrarlas no mejora nada salvo la consistencia.

Las llaves foráneas se nombran en el decorador, no por convención del motor:

```ts
@ManyToOne(..., { foreignKeyConstraintName: 'fk_empleado_empresa' })
```

Los índices y las restricciones de unicidad también van declarados en la entidad. Sin eso,
TypeORM genera nombres distintos en cada arranque y el esquema no se puede comparar.

### Idioma

Todo en castellano: nombres de variables, nombres de función, comentarios y **mensajes de
error que llegan al cliente**. Los identificadores de columna y de tabla se mantienen
compatibles con lo que ya hay en la base.

Los mensajes del framework y de `class-validator` vienen en inglés y se traducen en
`common/errores.ts`, que indexa por nombre de validador (`isString`, `maxLength`) y no por
el texto, porque el texto incluye los límites concretos y cambia en cada DTO.

### Formato de respuestas

Listados:

```json
{ "datos": [], "total": 0 }
```

`RespuestaPaginada<T>` en `common/paginacion.ts`. Los valores por defecto de paginación
viven en código, no en la base de datos.

Detalle: la entidad o DTO directamente, sin envolver.

### Formato de errores

```json
{ "error": "Sin permisos", "message": "...", "statusCode": 403 }
```

Y cuando falla la validación, un campo más:

```json
{ "error": "Peticion incorrecta", "message": "Los datos enviados no son validos",
  "errores": [{ "campo": "email", "mensaje": "debe ser un correo electronico valido" }],
  "statusCode": 400 }
```

**No es RFC 9457.** El filtro `FiltroErrores` devuelve JSON propio y no declara
`application/problem+json`. Convertirlo cambia el contrato con el frontend, así que se
propone hacerlo solo en la fase que lo toque, no de paso.

Un detalle de seguridad ya resuelto: el 404 no distingue entre "no existe" y "existe en
otra empresa". Sondear la existencia de registros ajenos por la diferencia entre 403 y 404
es una fuga de información, y por eso un recurso de otra empresa devuelve 404.

### Estilo de pruebas

- Unitarias: `*.spec.ts` junto al código, dentro de `src/`. Vitest con `describe`/`it`.
- E2E: `test/*.e2e-spec.ts` contra **MySQL real**, arrancando la aplicación Nest completa.
- `vitest.config.e2e.ts` fija `fileParallelism: false`. Las suites comparten la misma base
  y conceden permisos temporales sobre los roles; en paralelo, una suite puede quitarle a
  otra el permiso que acaba de darle.
- Las pruebas que dependen unas de otras viven en un único `describe` secuencial, en vez de
  repartirse en ficheros independientes, porque el orden es parte delArrange.
- El soporte común está en `test/soporte.ts`: ids de prueba, creación de app, limpieza y
  tokens.

## 3. Qué ya existe y se reutiliza

Nada de esto se duplica ni se reescribe.

### Modelo de datos

Nueve migraciones aplicadas, trece tablas. Están las entidades que pedía el enunciado:

`empresa`, `departamento`, `puesto`, `persona`, `empleado`, `usuarios`, `usuario_empresa`,
`rol`, `permiso`, `rol_permiso`, `refresh_token`, `auditoria`.

Lo que ya está resuelto:

- `persona` separada de `empleado`: una persona puede trabajar en varias empresas.
- Claves foráneas compuestas con `ON DELETE`/`ON UPDATE` explícitos, e índices en cada FK.
- UNIQUE compuestos por empresa, no globales.
- CHECK en los estados y en `fecha_fin >= fecha_inicio`.
- Jerarquía de usuarios con autorreferencia, prevention de ciclos y consultas con CTE
  recursivo.
- Auditoría con quién, qué, cuándo y valores antes/después en `json`.
- Borrado lógico en las entidades de negocio.
- `empleado.version` como columna de bloqueo optimista, con 409 en caso de conflicto.
- Columnas generadas calculadas por MySQL, no por TypeORM.

### Seguridad

- Cifrado en aplicación con AES-256-GCM para documento, IBAN y salario, e índices
  deterministas HMAC para localizarlos sin descifrar.
- RBAC por empresa activa, con el rol resuelto contra las membresías en cada petición.
- `empleado.sensible.leer` como permiso único para leer salario e IBAN.
- Refresh tokens rotativos, guardados como HMAC, con familia completa para detectar reuso.
- Rate limiting global y por endpoint, cabeceras de seguridad y CORS con `credentials`.
- Consultas parametrizadas en todo el código, sin concatenación de SQL.

### Operativa

- Cifrado de lo que quedó en claro: `npm run cifrar-datos`.
- Retención de `auditoria` y `refresh_token`: `npm run mantener`, sin borrado sin
  confirmación.
- Generación del volcado: `npm run esquema:dump`.
- Seed de dos empresas con roles distintos para el mismo usuario.
- CI en `.gitlab-ci.yml`, con job rápido sin base y job e2e con MySQL de servicio.

## 4. Qué falta

Ordenado por lo que bloquea a lo demás.

### Alta: son requisitos explícitos del enunciado

1. **Prefijo `/api/v1`.** No existe. Los controladores son `@Controller('personas')` y no
   hay `setGlobalPrefix`. Añadirlo cambia la URL de todo lo que ya hay, así que conviene
   decidirlo antes de que el frontend consuma nada.

2. **CRUD de empresas, usuarios, roles y membresías.** Solo existen empresas, personas,
   empleados, departamentos y puestos. Faltan los cuatro bloques de API. El modelo de
   datos sí está; lo que falta es la capa HTTP.

3. **`/health` y `/ready`.** No existen. `/ready` debe comprobar la base de datos.

4. **OpenAPI.** `@nestjs/swagger` está instalado pero `main.ts` no inicializa
   `SwaggerModule`. Mientras tanto los endpoints no están documentados.

5. **Diagrama ER en Mermaid.** No hay ninguno. Es entregable pedido.

6. **`Idempotency-Key`.** No hay soporte. Se pide en creaciones críticas, donde un reintento
   por red duplica el alta.

7. **Filtrado por `empresa_id` en una sola capa.** Hoy está escrito a mano en seis
   servicios: `empresaId` aparece 7 veces en `auth.service.ts`, 9 en `sesiones.service.ts`,
   9 en `empleado.service.ts`, 6 en `membresias.service.ts` y 4 en cada catálogo. Funciona,
   y hay pruebas que demuestran que un recurso de otra empresa devuelve 404 o 403, pero es
   exactamente el riesgo que el enunciado quiere eliminar: basta un servicio nuevo que
   olvide la cláusula.

   **Decisión: opción A, helper explícito en la capa común.** Se descarta el interceptor o
   subscriber automático. El filtro se deja visible en el código, porque cuando una
   consulta devuelve algo que no debería, poder leer por qué es más valioso que la
   garantía de que nadie se olvidó. La protección real la dan las pruebas de aislamiento.

### Media

8. **2FA (TOTP)**, preparado pero no implementado.
9. **RFC 9457** en el formato de error, en vez del JSON propio actual.
10. **OpenTelemetry**, para trazas.
11. **`docker-compose.yml`**, para levantar el backend y la base a la vez.

### Menor

12. Búsqueda parcial por documento. El índice es determinista y no admite comodines; hacerlo
    parcial exigiría descifrar todas las filas para compararlas.
13. Rotación de `DATA_ENCRYPTION_KEY`. Hoy no hay herramienta, y rotarla deja ilegibles los
    documentos, IBAN y salarios ya cifrados.
14. Que un empleado vea sus propios datos. No implementado.

## 5. Dependencias nuevas

Cuatro, aprobadas. **Ninguna se ha instalado todavía**: se instala en la fase que la
necesita, no antes.

| Paquete | Para qué | Por qué hace falta |
| --- | --- | --- |
| `@nestjs/terminus` | `/health` y `/ready` | No hay equivalente en el proyecto. Es el paquete oficial de Nest para health checks |
| `otpauth` | 2FA TOTP | No hay nada parecido instalado. Genera y verifica TOTP |
| `@opentelemetry/*` | Trazas distribuidas | Paquetes oficiales. Sin alternativa razonable |
| `otplib` | Alternativa a `otpauth` | Solo si se prefiere su API más simple. **No se instalan las dos** |

### Lo que no necesita dependencia nueva

- **Idempotencia**: tabla propia y un guard. No hay paquete en el proyecto y los que
  existen fuera asumen Redis, que no está.
- **RFC 9457**: es formato de respuesta, no una librería. Se resuelve en
  `FiltroErrores`.
- **Filtrado central**: es código propio sobre `common/`.
- **OpenAPI**: `@nestjs/swagger` ya está instalado, solo falta montarlo.

## 6. Decisiones tomadas en esta fase

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Hash de contraseñas | bcrypt | Ya es el estándar del repositorio |
| Framework de pruebas | Vitest | Ya es el del repositorio |
| Nombres de columnas | Inglés en entidades, castellano en infraestructura | Ya es lo que hay en las migraciones |
| Tipo de id | `char(36)` con UUID v7 | Ya es la convención existente |
| Filtrado por empresa | Opción A, helper explícito | Legibilidad frente a garantía automática |
| Formato de error | JSON propio | Migrar a RFC 9457 rompe el contrato con el frontend |
| Prefijo de versión | `/api/v1`, a confirmar | Cambia la URL de lo que ya existe |