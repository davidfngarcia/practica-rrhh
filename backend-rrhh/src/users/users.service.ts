    import { Injectable } from '@nestjs/common';
    import { InjectRepository } from '@nestjs/typeorm';
    import { Repository } from 'typeorm';
    import { Usuario } from './user.entity.js';

    @Injectable()
    export class UsersService {
      constructor(
        @InjectRepository(Usuario)
        private readonly usuariosRepository: Repository<Usuario>,
      ) { }

      // Busca un usuario por su nombre. Devuelve null si no existe.
      async findByUsername(nombreUsuario: string): Promise<Usuario | null> {
        // Imprimamos todos los usuarios que ve la BD en este instante
        const todosLosUsuarios = await this.usuariosRepository.find();
        console.log('--- USUARIOS EN LA BD QUE VE RENDER ---', todosLosUsuarios);

        return this.usuariosRepository.findOne({ where: { usuario: nombreUsuario } });
      }
    }