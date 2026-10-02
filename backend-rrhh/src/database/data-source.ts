import { fileURLToPath } from 'node:url';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config({ quiet: true });

const RUTA_MIGRACIONES = fileURLToPath(
  new URL('./migrations/*.js', import.meta.url),
);
const RUTA_ENTIDADES = fileURLToPath(
  new URL('../**/*.entity.js', import.meta.url),
);

export function crearOpcionesDataSource(): DataSourceOptions {
  return {
    type: 'mysql',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [RUTA_ENTIDADES],
    migrations: [RUTA_MIGRACIONES],
    migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
    synchronize: false,
    logging: false,
    ssl: { rejectUnauthorized: false },
  };
}

export const dataSource = new DataSource(crearOpcionesDataSource());
