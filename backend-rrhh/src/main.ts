import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita CORS: le permite al navegador aceptar peticiones
  // que vienen desde el frontend, aunque esté en otro puerto/origen.
  app.enableCors({
    origin: [
      'http://localhost:4200',   // Angular corriendo en Docker/Podman
      'http://localhost',        // por si accedes sin puerto (80 por defecto)
    ],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();