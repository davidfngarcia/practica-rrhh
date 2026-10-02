import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { configurarCuerpoJson } from './common/cuerpo.js';
import { FiltroErrores, pipeValidacion } from './common/errores.js';
import { configApp } from './config/config.js';

async function bootstrap() {
  const config = configApp();

  // `bodyParser: false` porque el parser se registra en `configurarCuerpoJson`, que
  // responde en castellano cuando el JSON no se puede interpretar.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // El puerto de origen real llega en X-Forwarded-For detras de un proxy. Sin esto,
  // `request.ip` seria siempre la IP del proxy y la columna `auditoria.ip` no
  // serviria para nada. Se configura sobre la instancia de Express porque Nest no
  // expone `trustProxy` en sus opciones de arranque.
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', true);

  configurarCuerpoJson(app);

  /**
   * Sin este pipe, los decoradores de `class-validator` no se ejecutan: el controlador
   * recibiria el cuerpo tal cual. Un `empresa_id` numerico o un array en `password`
   * llegarian hasta la base de datos.
   *
   * Se usa la variante de `common/errores.ts` para que los mensajes de validacion
   * lleguen en castellano y con el campo que falla.
   */
  app.useGlobalPipes(pipeValidacion());

  // Un solo formato de error para toda la API, tambien en castellano.
  app.useGlobalFilters(new FiltroErrores());

  // Cabeceras de seguridad basicas: evita MIME sniffing, clickjacking y XSS reflejado.
  app.use(
    helmet({
      // La API sirve JSON, no HTML con scripts: una CSP restrictiva no aporta y
      // complica el consumo desde el frontend.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // CORS: el navegador acepta peticiones desde el frontend, que corre en otro
  // puerto. `credentials` es necesario para que viaje la cookie del refresh token.
  app.enableCors({
    origin: [
      'http://localhost:4200', // Angular en Docker/Podman
      'http://localhost', // por si se accede sin puerto (80 por defecto)
    ],
    credentials: true,
  });

  await app.listen(config.port);

  // No se registran credenciales: host, usuario y nombre de base bastan para
  // averiguar bastante sobre la instalacion.
  console.log(`API escuchando en el puerto ${config.port} (${config.nodeEnv})`);
}

bootstrap();
