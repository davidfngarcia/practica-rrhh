import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../database/entities/usuario.entity.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
