import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { configurarCuerpoJson } from './common/cuerpo.js';
import { FiltroErrores, pipeValidacion } from './common/errores.js';
import { configurarPrefijo } from './common/prefijo.js';
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

  /**
   * Prefijo de version de la API. Sin esto, cambiar de contrato obligaria a romper a
   * todos los clientes a la vez; con el, `/api/v1` y `/api/v2` pueden convivir mientras
   * los clientes migran.
   *
   * La configuracion vive en `common/prefijo.ts` porque las pruebas E2E necesitan el mismo
   * prefijo: si cada una escribiera el suyo, las pruebas darian verde contra rutas que ya
   * no existen.
   */
  configurarPrefijo(app);

  /**
   * OpenAPI.
   *
   * Se monta antes que `listen` porque `SwaggerModule.setup` registra sus propias rutas y
   * hereda el prefijo global a menos que se le diga lo contrario.
   *
   * El documento se publica solo fuera de produccion. Es una descripcion completa de
   * cada endpoint y de cada permiso, y publicarla en produccion es darle a quien quiera
   * un mapa de la superficie de ataque.
   */
  if (config.nodeEnv !== 'production') {
    const documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API de RRHH')
        .setDescription(
          'Gestion de personal multiempresa. Cada peticion se resuelve contra la ' +
            'empresa activa del token; no hay ninguna ruta que acepte un `empresa_id` ' +
            'del cliente, porque permitirlo seria permitir leer datos de otra empresa.',
        )
        .setVersion('1.0')
        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Token de acceso. Se obtiene en `POST /api/v1/auth/login` y caduca a los ' +
              '15 minutos. El refresh va en cookie httpOnly y no se envia aqui.',
          },
          'bearer',
        )
        .addTag('Auth', 'Sesion, empresa activa y perfil propio.')
        .addTag('Puestos', 'Catalogo de puestos.')
        .addTag('Departamentos', 'Catalogo de departamentos.')
        .addTag('Personas', 'Catalogo global de personas.')
        .addTag('Empleados', 'Contrataciones por empresa.')
        .addTag('Empresa', 'Datos de la empresa de la sesion.')
        .build(),
    );

    SwaggerModule.setup('api/docs', app, documento, {
      // `useGlobalPrefix: false` porque la ruta se indica completa. Sin esto, Swagger
      // antepondria `api/v1` y el documento quedaria en `/api/v1/api/docs`, que no es
      // una direccion estable: cambiar la version moveria la documentacion.
      useGlobalPrefix: false,
      // `jsonDocumentUrl` permite descargar el JSON, que es lo que se mete en el
      // generador de clientes del frontend.
      jsonDocumentUrl: 'api/docs/openapi.json',
      customSiteTitle: 'API de RRHH',
    });
  }

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

  if (config.nodeEnv !== 'production') {
    console.log(`Documentacion de la API en /api/docs`);
  }
}

bootstrap();
