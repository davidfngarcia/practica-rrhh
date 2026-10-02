import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { configApp } from '../config/config.js';
import { Empresa } from '../database/entities/empresa.entity.js';
import { Permiso } from '../database/entities/permiso.entity.js';
import { RefreshToken } from '../database/entities/refresh-token.entity.js';
import { Rol } from '../database/entities/rol.entity.js';
import { RolPermiso } from '../database/entities/rol-permiso.entity.js';
import { Usuario } from '../database/entities/usuario.entity.js';
import { UsuarioEmpresa } from '../database/entities/usuario-empresa.entity.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard, PermissionsGuard } from './guards.js';
import { JwtStrategy } from './jwt.strategy.js';
import { MembresiasService } from './membresias.service.js';
import { SesionesService } from './sesiones.service.js';
import { TokenHashService } from './token-hash.service.js';

@Module({
  imports: [
    UsersModule,
    AuditoriaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([
      Usuario,
      RefreshToken,
      UsuarioEmpresa,
      Rol,
      Permiso,
      RolPermiso,
      Empresa,
    ]),
    JwtModule.register({
      global: true,
      secret: configApp().jwtSecret,
      // `ms.StringValue` es lo que espera la version de jsonwebtoken instalada;
      // el valor viene de una variable de entorno ya validada como no vacia.
      signOptions: {
        expiresIn: configApp()
          .jwtAccessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    MembresiasService,
    SesionesService,
    TokenHashService,
    JwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    PermissionsGuard,
    MembresiasService,
    TokenHashService,
  ],
})
export class AuthModule {}
