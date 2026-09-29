import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) { }

  async login(nombreUsuario: string, passwordPlain: string) {
    console.log('--- INTENTO DE LOGIN ---');
    console.log('Usuario recibido en el body:', nombreUsuario);

    // 1. Buscamos al usuario
    const user = await this.usersService.findByUsername(nombreUsuario);
    console.log('Usuario encontrado en la BD:', user);

    if (!user) {
      console.log('Error: El usuario no existe en la BD');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 2. Comparamos contraseñas
    console.log('Password plano recibido:', passwordPlain);
    console.log('Hash guardado en la BD:', user.password_hash); // (o user.passwordHash según tu entidad)

    const passwordValida = await bcrypt.compare(passwordPlain, user.password_hash);
    console.log('¿La contraseña coincide?:', passwordValida);

    if (!passwordValida) {
      console.log('Error: La contraseña no coincide con el hash');
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = { sub: user.usuario, username: user.usuario };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}