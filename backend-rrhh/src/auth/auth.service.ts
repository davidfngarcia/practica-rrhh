import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(nombreUsuario: string, passwordPlain: string) {
    // 1. Buscamos al usuario por su nombre de usuario
    const user = await this.usersService.findByUsername(nombreUsuario);

    // 2. Si no existe, rechazamos sin dar detalles (mensaje genérico)
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 3. Comparamos el password contra el hash guardado (passwordHash)
    const passwordValida = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 4. Si todo coincide, generamos el token con los campos reales de tu entidad
    const payload = { sub: user.usuario, username: user.usuario };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }
}