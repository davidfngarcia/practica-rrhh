import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto } from './login.dto.js';

@Controller('auth') // prefijo de todas las rutas de este controlador: /auth
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login') // ruta final: POST /auth/login
  @HttpCode(HttpStatus.OK) // por defecto Nest devuelve 201, aquí forzamos 200
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.usuario, loginDto.password);
  }
}