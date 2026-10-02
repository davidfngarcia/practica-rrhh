# CFP - RRHH (Portal de Gestión Humana)

Monorepo para desarrollo del sistema interno de practicantes de gestión de recursos humanos.

---

## 1. Estructura del Repositorio

```text
practica-rrhh/
├── backend-rrhh/     # API REST: NestJS + TypeScript + TypeORM sobre MySQL 8
├── frontend-rrhh/    # Angular (Standalone Components + Signals)
└── database-rrhh/    # schema_mysql.sql y el contenedor que lo carga al arrancar
```

La documentación del backend vive en
[`backend-rrhh/docs/`](backend-rrhh/docs): el esquema, las migraciones y las decisiones de
mapeo están en [`esquema.md`](backend-rrhh/docs/esquema.md).

---

## 2. Puesta en marcha del backend

```bash
cd backend-rrhh
npm install
cp .env.template .env   # y rellenar los valores
npm run migration:run
npm run semilla
npm run start:dev
```

`.env` necesita cuatro secretos de al menos 32 caracteres: `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `DATA_HASH_KEY` y `DATA_ENCRYPTION_KEY`. Para generarlos:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Si la base ya tenía personas, `npm run cifrar-datos` es obligatorio: sin él el documento
de identidad sigue en claro y las búsquedas devuelven cero sin dar ningún error.

Detalle completo en [`backend-rrhh/README.md`](backend-rrhh/README.md).