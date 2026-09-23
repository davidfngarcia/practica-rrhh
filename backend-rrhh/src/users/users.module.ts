import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from './user.entity.js';
import { UsersService } from './users.service.js';
 
@Module({
  imports: [TypeOrmModule.forFeature([Usuario])], // registra la entidad Usuario en este módulo
  providers: [UsersService],
  exports: [UsersService], // permite que otros módulos (como Auth) usen este servicio
})
export class UsersModule {}
 