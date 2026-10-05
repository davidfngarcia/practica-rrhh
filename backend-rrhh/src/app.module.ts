import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configApp } from './config/config.js';
import { DatabaseModule } from './database/database.module.js';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DepartamentosModule } from './departamentos/departamento.module.js';
import { PuestosModule } from './puestos/puesto.module.js';
import { PersonasModule } from './personas/persona.module.js';
import { EmpleadosModule } from './empleados/empleado.module.js';
import { SaludModule } from './salud/salud.module.js';
import { EmpresasModule } from './empresas/empresa.module.js';
import { RolesModule } from './roles/rol.module.js';
import { JwtAuthGuard, PermissionsGuard } from './auth/guards.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    DepartamentosModule,
    PuestosModule,
    PersonasModule,
    EmpleadosModule,
    SaludModule,
    EmpresasModule,
    RolesModule,
    // Limite global por IP. Los endpoints de login y refresh llevan ademas su
    // propio limite, mas estricto.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: configApp().throttleGlobal },
    ]),
  ],
  providers: [
    // Primero el limite de peticiones, para que un login masivo se descarte antes
    // de llegar a bcrypt. Sin registrar el guard, los decoradores `@Throttle` de
    // cada endpoint no se aplican.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    /**
     * Guard global: por defecto se exige token. Un endpoint nuevo nace protegido y
     * hay que marcarlo como publico de forma explicita con `@Public()`, que es la
     * direccion segura: el olvido no deja nada expuesto.
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Segundo: los permisos se comprueban con la sesion ya cargada por el anterior.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

// `configApp()` valida las variables al importar este archivo, antes de que
// Nest intente levantar nada. Si falta un secreto, el proceso muere en el arranque
// en lugar de firmar tokens con una clave por defecto.
configApp();
