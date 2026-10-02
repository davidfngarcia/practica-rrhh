import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { crearOpcionesDataSource } from './data-source.js';
import { Auditoria } from './entities/auditoria.entity.js';
import { Departamento } from './entities/departamento.entity.js';
import { Empleado } from './entities/empleado.entity.js';
import { Empresa } from './entities/empresa.entity.js';
import { Persona } from './entities/persona.entity.js';
import { Permiso } from './entities/permiso.entity.js';
import { Puesto } from './entities/puesto.entity.js';
import { RefreshToken } from './entities/refresh-token.entity.js';
import { Rol } from './entities/rol.entity.js';
import { RolPermiso } from './entities/rol-permiso.entity.js';
import { Usuario } from './entities/usuario.entity.js';
import { UsuarioEmpresa } from './entities/usuario-empresa.entity.js';

/**
 * Lista explicita de entidades. El glob `RUTA_ENTIDADES` de `data-source.ts` se
 * mantiene para la CLI de migraciones, pero el registro aqui es deliberado: si
 * `autoLoadEntities` combinara con el glob, cualquier entidad quedaria duplicada
 * en los metadatos de TypeORM.
 */
export const ENTIDADES = [
  Usuario,
  Empresa,
  Persona,
  Departamento,
  Puesto,
  Empleado,
  Permiso,
  Rol,
  RolPermiso,
  UsuarioEmpresa,
  RefreshToken,
  Auditoria,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...crearOpcionesDataSource(),
        entities: ENTIDADES,
        autoLoadEntities: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
