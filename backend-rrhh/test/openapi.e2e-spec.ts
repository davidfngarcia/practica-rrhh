/**
 * Documento OpenAPI (e2e).
 *
 * El documento se genera en memoria, igual que en `main.ts`, pero con los mismos
 * decoradores que la app real. Se prueba a proposito y no "a inspeccion": un documento
 * OpenAPI que se genera sin errores puede estar vacio, con un `object` sin propiedades
 * donde deberia haber un DTO, o con un endpoint que devuelve un codigo que nunca envia.
 * Los tres casos compilan, pasan el lint y rompen al cliente que los consume.
 *
 * Se usa `SwaggerModule.createDocument` con `ignoreGlobalPrefix` en su valor por defecto
 * porque es lo que hace `main.ts`: si aqui se ignorase el prefijo y alla no, las rutas
 * del documento y las de la API dejarian de coincidir sin que nada fallara.
 */
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearAppDePrueba } from './soporte.js';

describe('Documento OpenAPI (e2e)', () => {
  let app: INestApplication;
  let documento: OpenAPIObject;

  beforeAll(async () => {
    app = await crearAppDePrueba();
    documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API de RRHH')
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')
        .build(),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const rutas = () => Object.keys(documento.paths);

  it('documenta la API bajo el prefijo de version', () => {
    expect(rutas()).toContain('/api/v1/personas');
    expect(rutas()).toContain('/api/v1/empleados');
    expect(rutas()).toContain('/api/v1/departamentos');
    expect(rutas()).toContain('/api/v1/puestos');
    expect(rutas()).toContain('/api/v1/auth/login');
  });

  it('no documenta las sondas de salud', () => {
    // Van fuera del prefijo y sin decoradores. Documentarlas daria a entender que forman
    // parte del contrato con el frontend, que es justo lo que no son.
    expect(rutas().some((r) => r.includes('health'))).toBe(false);
    expect(rutas().some((r) => r.includes('ready'))).toBe(false);
  });

  it('no acepta `empresa_id` del cliente en ninguna ruta de negocio', () => {
    // La empresa sale del token. Si alguna ruta la aceptara, permitiria leer datos de
    // otra empresa cambiando un parametro, que es justo lo que el diseño prohibe.
    const rutasDeNegocio = rutas().filter((r) =>
      /personas|empleados|departamentos|puestos/.test(r),
    );

    expect(rutasDeNegocio.length).toBeGreaterThan(0);

    for (const ruta of rutasDeNegocio) {
      const operaciones = documento.paths[ruta] as Record<string, unknown>;
      for (const [verbo, operacion] of Object.entries(operaciones)) {
        const parametros =
          (operacion as { parameters?: unknown[] }).parameters ?? [];
        const nombres = parametros
          .map((p) => (p as { name?: string }).name)
          .filter(Boolean);
        expect(
          nombres,
          `${verbo.toUpperCase()} ${ruta} acepta empresa_id`,
        ).not.toContain('empresa_id');
      }
    }
  });

  it('cada operacion tiene resumen y respuestas de error', () => {
    for (const [ruta, operaciones] of Object.entries(documento.paths)) {
      for (const [verbo, operacion] of Object.entries(operaciones)) {
        const op = operacion as {
          summary?: string;
          responses?: Record<string, unknown>;
        };

        expect(op.summary, `${verbo} ${ruta} sin resumen`).toBeTruthy();

        const estados = Object.keys(op.responses ?? {});
        expect(estados, `${verbo} ${ruta} sin respuestas`).not.toHaveLength(0);

        // Toda ruta protegida declara 401: es el unico codigo con el que el frontend
        // puede reaccionar sin saber por que se le ha rechazado la peticion.
        expect(estados, `${verbo} ${ruta} sin 401 documentado`).toContain(
          '401',
        );
      }
    }
  });

  it('los DTO de respuesta tienen esquema, no un object vacio', () => {
    const esquemas = (documento.components?.schemas ?? {}) as Record<
      string,
      { properties?: Record<string, unknown> }
    >;

    const respuestaPersona = esquemas['PersonaRespuestaDto'];
    expect(
      respuestaPersona,
      'falta el esquema de PersonaRespuestaDto',
    ).toBeDefined();
    expect(Object.keys(respuestaPersona.properties ?? {})).toContain(
      'numero_documento',
    );
  });

  it('ningun cuerpo de peticion apunta a un esquema que no exista', () => {
    const esquemas = (documento.components?.schemas ?? {}) as Record<
      string,
      unknown
    >;

    // Los DTO de entrada solo llevan decoradores de `class-validator`; sus propiedades las
    // anade el plugin de Swagger de `nest-cli.json` al compilar. Ese plugin corre en
    // `nest build`, no en Vitest, asi que aqui sus clases salen a veces como `object`:
    // comprobar sus propiedades desde una prueba de Vitest daria un falso negativo.
    //
    // Lo que si se puede comprobar, y es el fallo que de verdad rompe al cliente, es que
    // el `requestBody` apunte a un esquema que no existe en `components`. Un `$ref`
    // colgante deja al generador de clientes sin ningun tipo que usar.
    const referencias = new Set<string>();
    const recoger = (valor: unknown) => {
      if (Array.isArray(valor)) return valor.forEach(recoger);
      if (valor && typeof valor === 'object') {
        for (const [clave, hijo] of Object.entries(valor)) {
          if (clave === '$ref' && typeof hijo === 'string') {
            referencias.add(hijo.replace('#/components/schemas/', ''));
          }
          recoger(hijo);
        }
      }
    };
    recoger(documento.paths);

    expect(referencias.size).toBeGreaterThan(0);

    for (const nombre of referencias) {
      expect(
        esquemas[nombre],
        `el documento referencia ${nombre}, que no existe`,
      ).toBeDefined();
    }
  });

  it('los DTO de entrada se declaran en el documento', () => {
    const esquemas = (documento.components?.schemas ?? {}) as Record<
      string,
      unknown
    >;

    // Aunque el plugin no corra bajo Vitest, el DTO tiene que estar registrado: si un
    // `requestBody` se queda sin `type`, el cliente recibe un cuerpo libre y no valida
    // nada de lo que manda.
    for (const nombre of ['CrearPersonaDto', 'CrearEmpleadoDto']) {
      expect(esquemas[nombre], `falta el esquema de ${nombre}`).toBeDefined();
    }
  });

  it('documenta el codigo real de cada verbo', () => {
    const crear = documento.paths['/api/v1/puestos']?.post as {
      responses?: Record<string, unknown>;
    };
    const actualizar = documento.paths['/api/v1/puestos/{id}']?.patch as {
      responses?: Record<string, unknown>;
    };
    const eliminar = documento.paths['/api/v1/puestos/{id}']?.delete as {
      responses?: Record<string, unknown>;
    };

    // Nest devuelve 201 en POST. Documentar 200 haria que el generador de clientes
    // esperase un codigo que nunca llega.
    expect(Object.keys(crear.responses ?? {})).toContain('201');
    expect(Object.keys(actualizar.responses ?? {})).toContain('200');
    expect(Object.keys(eliminar.responses ?? {})).toContain('204');
  });
});
