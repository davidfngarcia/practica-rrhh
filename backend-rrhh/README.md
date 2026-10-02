# backend-rrhh

API de recursos humanos multiempresa. NestJS + TypeORM sobre MySQL 8.

El modelo separa lo que pertenece a la persona de lo que pertenece a la empresa: una
persona es un catálogo global sin empresa, y ser empleado de una empresa es un vínculo
con su propia vigencia. Esa separación es la que permite que la misma persona esté de
alta en dos empresas sin duplicar sus datos, y es la razón de que casi todas las
decisiones del diseño estén tomadas alrededor de ella.

## Puesta en marcha

```bash
npm install
cp .env.template .env   # y rellenar los valores
npm run migration:run
npm run cifrar-datos     # solo si la base ya tenía personas
npm run semilla
npm run start:dev
```

`.env` necesita al menos las variables de base de datos y cuatro secretos de al menos 32
caracteres: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATA_HASH_KEY` y
`DATA_ENCRYPTION_KEY`. Para generarlos:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

La semilla crea datos de desarrollo: dos empresas, un usuario en ambas y los roles
asociados. Es idempotente, así que volver a ejecutarla no duplica nada.

### `cifrar-datos` es obligatorio si la base ya tenía personas

El documento de identidad se guarda **cifrado** con AES-256-GCM. Aplicar la migración
no convierte lo que ya había escrito en claro: hay que ejecutar `npm run cifrar-datos`
después de `migration:run`.

Sin ese paso la aplicación arranca con normalidad y el filtro por documento devuelve
cero resultados sin ningún error: el índice nunca llegó a calcularse. El script es
idempotente, así que repetirlo es inofensivo, y avisa de los documentos duplicados que
no puede resolver por su cuenta.

## Scripts

| Script                  | Qué hace                                            |
| ----------------------- | --------------------------------------------------- |
| `start` / `start:dev`   | Arranca la aplicación (con recarga al guardar)      |
| `build`                 | Compila a `dist/`                                   |
| `test`                  | Pruebas unitarias                                   |
| `test:e2e`              | Pruebas de extremo a extremo contra MySQL real      |
| `lint`                  | oxlint sobre `src/` y `test/`                       |
| `format`                | prettier sobre `src/` y `test/`                     |
| `migration:show`        | Estado de las migraciones                           |
| `migration:run`         | Aplica las migraciones pendientes                   |
| `migration:revert`      | Deshace la última migración                         |
| `cifrar-datos`          | Cifra los documentos que quedaron en claro         |
| `esquema:dump`          | Regenera el volcado `schema_mysql.sql`              |
| `mantener`              | Cuenta (y con `--aplicar`, borra) lo caducado       |
| `semilla`               | Crea o repara los datos de desarrollo               |

## Autenticación

`POST /auth/login` devuelve un access token en el cuerpo y el refresh en una cookie
`httpOnly`. El access token es corto a propósito (15 minutos por defecto): es el que
viaja en cada petición. El refresh se rota en cada uso y la familia de tokens se
revoca entera si se detecta un reuso, de modo que un token robado deja de servir al
detectar el robo y no después.

El token lleva `empresa_id`, así que **la empresa sale siempre de la sesión**. Ningún
endpoint acepta `empresa_id` en el cuerpo, en la ruta ni en los filtros: aceptarlo
permitiría que el rol RRHH de una empresa escribiera en el catálogo de otra.

`POST /auth/cambiar-empresa` emite un token para otra empresa de la que el usuario es
miembro y revoca el refresh anterior. Se audita como `CAMBIO_EMPRESA`, no como
`LOGOUT`: el usuario no cerró su sesión, pidió un token distinto.

## Rutas

| Ruta                                       | Método   | Permiso                  |
| ------------------------------------------ | -------- | ------------------------ |
| `/auth/login`                              | `POST`   | público                  |
| `/auth/refresh`                            | `POST`   | cookie de refresh        |
| `/auth/logout`                             | `POST`   | autenticado              |
| `/auth/me`                                 | `GET`    | autenticado              |
| `/auth/empresas`                           | `GET`    | autenticado              |
| `/auth/cambiar-empresa`                    | `POST`   | autenticado              |
| `/departamentos`, `/puestos`               | `GET`    | `<módulo>.leer`          |
| `/departamentos`, `/puestos`               | `POST`   | `<módulo>.crear`         |
| `/departamentos`, `/puestos`               | `PATCH`  | `<módulo>.actualizar`    |
| `/departamentos`, `/puestos`               | `DELETE` | `<módulo>.eliminar`      |
| `/personas`                                | `GET`    | `persona.leer`           |
| `/personas`                                | `POST`   | `persona.crear`          |
| `/personas`                                | `PATCH`  | `persona.actualizar`     |
| `/personas`                                | `DELETE` | `persona.eliminar`       |
| `/empleados`                               | `GET`    | `empleado.leer`          |
| `/empleados`                               | `POST`   | `empleado.crear`         |
| `/empleados`                               | `PATCH`  | `empleado.actualizar`    |
| `/empleados`                               | `DELETE` | `empleado.eliminar`      |

Cada recurso expone `GET /`, `GET /:id`, `POST /`, `PATCH /:id` y `DELETE /:id`. Los
`DELETE` devuelven `204` y son bajas lógicas: la fila se conserva porque es parte del
histórico.

## Datos sensibles

Documento de identidad, IBAN y salario se guardan **cifrados** con AES-256-GCM, con un
IV aleatorio por escritura. Salen en claro en la respuesta porque el cliente los
necesita, pero en la tabla no hay forma de leerlos ni de indexarlos.

Como el cifrado usa IV aleatorio, no admite búsquedas por fragmento: dos filas con el
mismo documento producen textos distintos. La igualdad y el UNIQUE van contra un
**índice ciego**, un HMAC-SHA256 determinista del dato, en columna aparte.

| Columna                    | Qué es                                       |
| -------------------------- | -------------------------------------------- |
| `persona.numero_documento` | documento cifrado                            |
| `persona.documento_indice` | HMAC, para el UNIQUE y el filtro exacto      |
| `empleado.salario_cifrado` | salario cifrado                              |
| `empleado.iban_cifrado`    | IBAN cifrado                                 |
| `empleado.iban_indice`     | HMAC, para el filtro exacto                  |

El documento y el IBAN usan contextos de HMAC distintos, precisamente para que no se
pueda deducir que una persona es un empleado comparando su IBAN con su documento.

**Consecuencia**: no hay búsqueda parcial por documento. `?numero_documento=` exige el
valor exacto y completo. Un `LIKE` sobre el texto cifrado devolvería cero en silencio.

`GET /empleados` admite `?iban=` y `?numero_documento=` como filtros exactos;
`?buscar=` sigue buscando por nombre, apellidos y código, que no están cifrados.

### Quien ve el salario y el IBAN: `empleado.sensible.leer`

Están detrás de un permiso propio, no de `empleado.leer`. Con solo `empleado.leer`
cualquier rol veía la nómina y las cuentas bancarias de toda la empresa, y el permiso
concedido no lo decía.

| Situación                                        | Resultado                             |
| ------------------------------------------------ | ------------------------------------- |
| Sin el permiso                                   | `salario` e `iban` no vienen en la respuesta |
| Con el permiso                                   | Llegan descifrados                     |
| Sin el permiso, en el cuerpo llega `salario`/`iban` | 403, y no se escribe nada         |

Sin el permiso las propiedades **no aparecen**, en vez de venir a `null`: un `null`
afirmaría que ese empleado no tiene salario, que es una verdad sobre la fila y no sobre
quién pregunta.

La escritura también exige el permiso. Un rol que puede modificar empleados pero no ver
sus salarios podría escribir un IBAN equivocado que luego no podría ni corregir ni borrar,
porque no lo vería en ninguna respuesta.

Lo reciben `RRHH`, que necesita la nómina, y `ADMIN_EMPRESA`, que es control total. El rol
`EMPLEADO` no lo tiene: puede ver el listado de empleados sin ver salarios ni cuentas.

La auditoría **no** guarda ninguno de estos valores en claro: `datos_antes` y
`datos_despues` los sustituye por `[oculto]`. Sin eso, el documento, el IBAN y el
salario se copiarían a una tabla que nadie recuerda tener cifrada, que es la más
consultada para responder "¿quién cambió esto y cuándo?".

## Multiempresa

Una empresa no se elige en la petición, viene en el token. Eso obliga a que cada
consulta lleve `empresa_id = sesion.empresa_id`, y en `empleado` no basta: el
departamento y el puesto se validan además contra esa misma empresa, porque un
empleado no puede estar adscrito al catálogo de otra.

Esa última regla no la aplica el código, la aplica la base: `empleado` tiene dos
llaves foráneas compuestas, `(empresa_id, departamento_id)` y
`(empresa_id, puesto_id)`. Si el servicio se olvidara de comprobarla, MySQL rechazaría
el INSERT. Ver [`docs/esquema.md`](docs/esquema.md) para el detalle de por qué el
mapeo de TypeORM no puede declarar esas relaciones.

## Pruebas

```bash
npm test        # unitarias
npm run test:e2e
```

Las e2e levantan la aplicación real contra MySQL (`vitest.config.e2e.ts`), no contra
un doble de test: el valor de este proyecto está justamente en las FKs compuestas, los
CHECK y las columnas generadas, y un doble no reproduce ninguno de los tres.

Requieren que la base tenga las migraciones aplicadas. Ejecutan los ficheros en serie
(`fileParallelism: false`) porque comparten base y conceden permisos temporales sobre
los roles para probar el aislamiento entre empresas; en paralelo, una suite puede
quitarle a otra el permiso que acaba de darle.

Cada suite registra los ids que crea y los borra al terminar, en vez de localizarlos
por el documento: al cifrarse, un `numero_documento LIKE '%-SUFIJO%'` ya no encuentra
nada, la limpieza creería haber borrado cero filas y la ejecución siguiente fallaría
por la llave foránea. Ese detalle no es hipotético: pasó.

Las unitarias cubren lo que no necesita base de datos: la redacción recursiva de datos
sensibles y el cifrado con sus índices ciegos. La redacción distingue dos cosas que se
confunden fácil: un objeto repetido en dos campos se copia dos veces, y solo un ciclo de
verdad se marca como `[circular]`. Marcarlo todo como circular perdería datos reales en
la auditoría.

Las pruebas que mueven datos los restauran en un `finally`. Si no, un fallo a mitad
deja las filas en un estado que hace fallar las pruebas siguientes, y el error real se
pierde entre los derivados.

### `.gitlab-ci.yml`

Dos jobs, en la misma etapa. `tipos-y-lint` (formato, tipos, lint y unitarias) es el
barato y va primero; si falla, no tiene sentido gastar minutos en levantar MySQL. `e2e`
levanta un `mysql:8.0` de servicio y espera a que acepte conexiones antes de migrar,
porque MySQL abre el puerto antes de tener listo el esquema y sin esa espera la primera
migración falla con `connection refused` pareciendo un fallo del proyecto.

Los secretos del job son valores fijos y públicos a propósito: son de una base efímera
que existe mientras dura el pipeline. Lo que no puede es que lleguen a un entorno real.
`DATA_ENCRYPTION_KEY` y `DATA_HASH_KEY` son distintas y de 64 hexadecimales porque
`config.ts` exige 32 caracteres como mínimo.

## Base de datos

La fuente de verdad del esquema son las migraciones de
`src/database/migrations/`. `synchronize` está en `false` y no debe activarse: el diff
que calcularía TypeORM borraría las llaves foráneas compuestas de `empleado`.

`database-rrhh/schema_mysql.sql` es un volcado generado, útil para levantar una base
vacía de un tirón (el `Dockerfile` de ese directorio lo usa). No editarlo a mano: si
cambias una migración, se regenera con

```bash
npm run esquema:dump
```

que lo extrae de `SHOW CREATE TABLE` sobre la base real. Editado a mano se queda
desactualizado sin que nada avise, y el contenedor acaba arrancando con un esquema que la
aplicación no espera.

## Mantenimiento

Ni `auditoria` ni `refresh_token` tienen tope de filas, así que crecen sin límite.
`auditoria` es la que más: registra también los intentos de login fallidos, que en una
base expuesta son la mayoría.

```bash
npm run mantener            # cuenta lo que caducó, no borra nada
npm run mantener -- --aplicar
```

Sin `--aplicar` el script solo cuenta. Un `DELETE` sin confirmación en algo que alguien
puede lanzar por cron a las tres de la mañana no es una comodidad, es una forma de
perder el histórico sin querer.

Los plazos salen de `RETENCION_TOKENS_DIAS` (30) y `RETENCION_AUDITORIA_DIAS` (365), y
son deliberadamente distintos: un refresh token caducado no vale nada, mientras que un
registro de auditoría puede ser la respuesta a un cambio de hace años.

Dos detalles de diseño que conviene no deshacer:

- **No hay `ON DELETE CASCADE` en `auditoria`.** Sus filas apuntan a `empresa` y a
  `usuarios`, y se guardan precisamente porque el recurso ya no está. Una baja en
  `empleado` no debe llevarse por delante quién lo cambió y cuándo.
- **`auditoria.fecha` es una columna generada**, calculada por MySQL a partir de
  `creado_en`. No se escribe a mano.

## Documentación

- [`docs/esquema.md`](docs/esquema.md): esquema, migraciones, cifrado y decisiones de
  mapeo.