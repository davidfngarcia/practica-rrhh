import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/guards.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Sonda de vida. Publica a proposito: no revela nada del negocio. */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
