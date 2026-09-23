import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
  ) {}

  // Busca un usuario por su nombre. Devuelve null si no existe.
  async findByUsername(nombreUsuario: string): Promise<Usuario | null> {
    return this.usuariosRepository.findOne({ where: { usuario: nombreUsuario } });
  }
}