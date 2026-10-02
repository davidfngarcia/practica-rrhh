import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CifradoService,
  CONTEXTO_DOCUMENTO_PERSONA,
  CONTEXTO_IBAN_EMPLEADO,
} from '../src/common/cifrado.service.js';
import { cifrarDocumentos } from '../src/database/cifrar-datos.js';
import { IDS_PRUEBA } from '../src/database/semilla.js';
import { PERMISO_SENSIBLES } from '../src/empleados/empleado.service.js';
import {
  SUFIJO,
  borrarEn,
  conPermisosTemporales,
  consultar,
  crearAppDePrueba,
  idsDeEmpleadosCreados,
  idsDePersonasCreadas,
  llamar,
  prepararBase,
  registrarEmpleado,
  registrarPersona,
  tokenEmpleado,
  tokenRRHH,
} from './soporte.js';

/**
 * Datos sensibles: que queda cifrado en la base, que vuelve en claro a la API y que no
 * debe quedar en ningun sitio mas.
 *
 * Estas pruebas van a la tabla con SQL directo en lugar de fiarse de la respuesta de la
 * API, porque el fallo que se quiere cazar es precisamente uno en el que la API
 * funciona bien y la base guarda el dato sin cifrar: si todo se comprobara por la API,
 * pasarian las dos cosas.
 */
describe('Datos sensibles (e2e)', () => {
  let app: INestApplication;
  let conexion: Connection;
  let rrhh: string;

  /** Iban valido y fijo, para no tener que inventarlo en cada prueba. */
  const IBAN = 'ES9121000418450200051332';

  let personaId: string;
  let documento: string;
  let empleadoId: string;

  /** Crea una persona de la prueba y devuelve su id. */
  async function crearPersona(marca: string): Promise<string> {
    const numero = `CC-${marca}-${SUFIJO}`;
    const respuesta = await llamar(app, 'POST', '/personas', {
      token: rrhh,
      cuerpo: {
        tipo_documento: 'CC',
        numero_documento: numero,
        nombres: `Nombre ${marca}`,
        apellidos: `Apellido ${SUFIJO}`,
      },
    });

    if (respuesta.estado !== 201) {
      throw new Error(
        `No se pudo crear la persona ${marca}: ${respuesta.estado} ${JSON.stringify(respuesta.cuerpo)}`,
      );
    }

    registrarPersona(respuesta.cuerpo.id);
    return respuesta.cuerpo.id;
  }

  /** Fila cruda de `persona`, tal y como esta en la tabla. */
  async function personaEnBruto(id: string): Promise<Record<string, unknown>> {
    const filas = await consultar(
      conexion,
      'SELECT * FROM persona WHERE id = ?',
      [id],
    );
    return filas[0] as Record<string, unknown>;
  }

  /** Fila cruda de `empleado`, tal y como esta en la tabla. */
  async function empleadoEnBruto(id: string): Promise<Record<string, unknown>> {
    const filas = await consultar(
      conexion,
      'SELECT * FROM empleado WHERE id = ?',
      [id],
    );
    return filas[0] as Record<string, unknown>;
  }

  /**
   * Todo lo que la auditoria guardo para una entidad, como texto.
   *
   * Se devuelve el JSON ya serializado porque la pregunta que se hace es si la cadena
   * del documento aparece en algun sitio, y eso solo se puede contestar sobre el texto
   * final que se escribe en la columna.
   */
  async function auditoriaDe(
    entidad: string,
    entidadId: string,
  ): Promise<string> {
    const filas = await consultar(
      conexion,
      'SELECT datos_antes, datos_despues FROM auditoria WHERE entidad = ? AND entidad_id = ?',
      [entidad, entidadId],
    );

    return filas
      .map((f) => `${f.datos_antes ?? ''} ${f.datos_despues ?? ''}`)
      .join(' ');
  }

  beforeAll(async () => {
    conexion = await prepararBase();
    app = await crearAppDePrueba();
    rrhh = await tokenRRHH(app);

    documento = `CC-SENS-${SUFIJO}`;
    personaId = await crearPersona('SENS');

    const alta = await llamar(app, 'POST', '/empleados', {
      token: rrhh,
      cuerpo: {
        persona_id: personaId,
        fecha_ingreso: '2026-01-15',
        codigo: `EMPS-${SUFIJO}`,
        salario: 54321.5,
        iban: IBAN,
      },
    });

    if (alta.estado !== 201) {
      throw new Error(
        `No se pudo crear el empleado: ${alta.estado} ${JSON.stringify(alta.cuerpo)}`,
      );
    }

    empleadoId = alta.cuerpo.id;
    registrarEmpleado(empleadoId);
  });

  afterAll(async () => {
    // `consultar` y `borrarEn` reciben un unico array, que se expande en un solo `IN (?)`.
    // Con dos `?` y un unico array, mysql2 rellena el primero y deja el segundo en la
    // consulta tal cual, y MySQL lo rechaza por sintaxis.
    const empleados = await consultar(
      conexion,
      'SELECT id FROM empleado WHERE id IN (?)',
      [[...idsDeEmpleadosCreados()]],
    );
    const ids = [
      ...empleados.map((e) => e.id as string),
      ...idsDePersonasCreadas(),
    ];

    await borrarEn(
      conexion,
      "DELETE FROM auditoria WHERE entidad IN ('persona', 'empleado') AND entidad_id IN (?)",
      ids,
    );
    await borrarEn(conexion, 'DELETE FROM empleado WHERE id IN (?)', ids);
    await borrarEn(conexion, 'DELETE FROM persona WHERE id IN (?)', [
      ...idsDePersonasCreadas(),
    ]);
  });

  describe('1. El documento se guarda cifrado', () => {
    it('lo que hay en la columna no es el numero que se envio', async () => {
      const fila = await personaEnBruto(personaId);

      expect(fila.numero_documento).not.toBe(documento);
      expect(String(fila.numero_documento)).toMatch(/^v1:/);
    });

    it('se guarda el indice ciego, que es lo que hace posible el UNIQUE y la busqueda', async () => {
      const fila = await personaEnBruto(personaId);

      expect(typeof fila.documento_indice).toBe('string');
      expect(fila.documento_indice).not.toBe(documento);
    });

    it('el indice no es reversible: no contiene el numero en ninguna parte', async () => {
      const fila = await personaEnBruto(personaId);
      const indice = String(fila.documento_indice);

      // El indice es un HMAC: no se parece al numero pero tampoco lo contiene.
      expect(indice).not.toContain(documento);
      expect(indice).not.toContain('CC-SENS');
    });

    it('la API si devuelve el numero en claro', async () => {
      const respuesta = await llamar(app, 'GET', `/personas/${personaId}`, {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.numero_documento).toBe(documento);
    });

    it('el indice se puede volver a calcular y coincide con el guardado', async () => {
      const cifrado = app.get(CifradoService);
      const fila = await personaEnBruto(personaId);

      expect(cifrado.indiceCiego('persona.numero_documento', documento)).toBe(
        fila.documento_indice,
      );
    });

    it('el texto guardado se puede descifrar y devuelve el numero original', async () => {
      const cifrado = app.get(CifradoService);
      const fila = await personaEnBruto(personaId);

      expect(cifrado.descifrar(String(fila.numero_documento))).toBe(documento);
    });

    it('el mismo documento produces un texto cifrado distinto cada vez', async () => {
      const cifrado = app.get(CifradoService);

      // Si dos cifrados del mismo dato salieran iguales, el IV no seria aleatorio y el
      // cifrado no esconderia nada: dos personas con el mismo dato serian iguales.
      expect(cifrado.cifrar(documento)).not.toBe(cifrado.cifrar(documento));
    });

    it('un documento mal formado no se descifra', async () => {
      const cifrado = app.get(CifradoService);

      expect(() => cifrado.descifrar('esto no esta cifrado')).toThrow();
    });
  });

  describe('2. La busqueda por documento usa el indice y sigue funcionando', () => {
    it('el filtro exacto encuentra a la persona', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/personas?numero_documento=${encodeURIComponent(documento)}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.total).toBe(1);
      expect(respuesta.cuerpo.datos[0].id).toBe(personaId);
    });

    it('el filtro exacto no encuentra a una persona con otro documento', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/personas?numero_documento=${encodeURIComponent(`CC-OTRO-${SUFIJO}`)}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.total).toBe(0);
    });

    it('un documento con formato invalido se rechaza con 400, no se busca a medias', async () => {
      const respuesta = await llamar(
        app,
        'GET',
        `/personas?numero_documento=${encodeURIComponent('no es un documento')}`,
        { token: rrhh },
      );

      expect(respuesta.estado).toBe(400);
    });
  });

  describe('3. Salario e IBAN se guardan cifrados', () => {
    it('el salario no esta en claro en la tabla', async () => {
      const fila = await empleadoEnBruto(empleadoId);

      expect(fila.salario_cifrado).toBeTruthy();
      expect(String(fila.salario_cifrado)).toMatch(/^v1:/);
      expect(String(fila.salario_cifrado)).not.toContain('54321');
    });

    it('el IBAN no esta en claro y si su indice', async () => {
      const fila = await empleadoEnBruto(empleadoId);

      expect(String(fila.iban_cifrado)).toMatch(/^v1:/);
      expect(String(fila.iban_cifrado)).not.toContain('ES9121');
      expect(typeof fila.iban_indice).toBe('string');
    });

    it('el indice del IBAN es distinto del del documento de su persona', async () => {
      const cifrado = app.get(CifradoService);
      const persona = await personaEnBruto(personaId);
      const empleado = await empleadoEnBruto(empleadoId);

      // Mismo HMAC, datos distintos. Un indice compartido permitiria saber que una
      // persona es un empleado comparando el IBAN con su documento.
      expect(empleado.iban_indice).not.toBe(persona.documento_indice);
      expect(cifrado.indiceCiego('empleado.iban', IBAN)).toBe(
        empleado.iban_indice,
      );
    });

    it('la API devuelve el IBAN y el salario descifrados', async () => {
      const respuesta = await llamar(app, 'GET', `/empleados/${empleadoId}`, {
        token: rrhh,
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.iban).toBe(IBAN);
      expect(Number(respuesta.cuerpo.salario)).toBe(54321.5);
    });

    it('la API nunca expone las columnas cifradas', async () => {
      const respuesta = await llamar(app, 'GET', `/empleados/${empleadoId}`, {
        token: rrhh,
      });

      expect(respuesta.cuerpo).not.toHaveProperty('salario_cifrado');
      expect(respuesta.cuerpo).not.toHaveProperty('iban_cifrado');
      expect(respuesta.cuerpo).not.toHaveProperty('iban_indice');
      expect(respuesta.cuerpo).not.toHaveProperty('codigo_vigente');
    });

    it('el listado tampoco expone las columnas internas', async () => {
      const respuesta = await llamar(app, 'GET', '/empleados', { token: rrhh });

      expect(respuesta.estado).toBe(200);
      for (const fila of respuesta.cuerpo.datos) {
        expect(fila).not.toHaveProperty('salario_cifrado');
        expect(fila).not.toHaveProperty('iban_cifrado');
      }
    });
  });

  describe('4. La auditoria no guarda datos sensibles en claro', () => {
    it('el alta de la persona no deja el documento en la auditoria', async () => {
      const registro = await auditoriaDe('persona', personaId);

      expect(registro).not.toBe('');
      expect(registro).not.toContain(documento);
      expect(registro).not.toContain('CC-SENS');
    });

    it('el alta del empleado no deja el IBAN ni el salario en la auditoria', async () => {
      const registro = await auditoriaDe('empleado', empleadoId);

      expect(registro).not.toBe('');
      expect(registro).not.toContain(IBAN);
      expect(registro).not.toContain('ES9121');
      expect(registro).not.toContain('54321');
    });

    it('el PATCH tampoco: ni el valor anterior ni el nuevo', async () => {
      const patch = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { salario: 77777, iban: 'ES9121000418450200051333' },
      });
      expect(patch.estado).toBe(200);

      const registro = await auditoriaDe('empleado', empleadoId);

      expect(registro).not.toContain('77777');
      expect(registro).not.toContain('54321');
      expect(registro).not.toContain('ES9121');
    });

    it('el documento tampoco se filtra al cambiarlo', async () => {
      const nuevoDocumento = `CC-NUEVO-${SUFIJO}`;
      const patch = await llamar(app, 'PATCH', `/personas/${personaId}`, {
        token: rrhh,
        cuerpo: { numero_documento: nuevoDocumento },
      });
      expect(patch.estado).toBe(200);

      const registro = await auditoriaDe('persona', personaId);

      expect(registro).not.toContain(nuevoDocumento);
      expect(registro).not.toContain(documento);

      // Se restauran los ids que espera el resto de la suite.
      const restaura = await llamar(app, 'PATCH', `/personas/${personaId}`, {
        token: rrhh,
        cuerpo: { numero_documento: documento },
      });
      expect(restaura.estado).toBe(200);
    });

    it('la auditoria si conserva el resto de los datos, para que siga siendo util', async () => {
      const filas = await consultar(
        conexion,
        "SELECT datos_despues FROM auditoria WHERE entidad = 'empleado' AND entidad_id = ? AND accion = 'CREAR'",
        [empleadoId],
      );

      // El driver devuelve la columna `json` ya parseada, asi que se serializa aqui para
      // poder buscar cadenas dentro del contenido.
      const datos = JSON.stringify(filas[0]?.datos_despues ?? {});

      expect(datos).toContain('fecha_ingreso');
      expect(datos).toContain('2026-01-15');
      expect(datos).toContain('[oculto]');
    });
  });

  describe('5. Concurrencia optimista', () => {
    it('la version empieza en 0 y sube con cada escritura', async () => {
      const alta = await llamar(app, 'GET', `/empleados/${empleadoId}`, {
        token: rrhh,
      });
      const primera = Number(alta.cuerpo.version);

      const patch = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { tipo_contrato: 'TEMPORAL', version: primera },
      });
      expect(patch.estado).toBe(200);
      expect(Number(patch.cuerpo.version)).toBeGreaterThan(primera);
    });

    it('un PATCH con la version antigua responde 409 y no cambia nada', async () => {
      const antes = await llamar(app, 'GET', `/empleados/${empleadoId}`, {
        token: rrhh,
      });
      const version = Number(antes.cuerpo.version);

      const uno = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { tipo_contrato: 'PRACTICAS', version },
      });
      expect(uno.estado).toBe(200);

      const dos = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { tipo_contrato: 'PLANTA', version },
      });

      expect(dos.estado).toBe(409);
      expect(String(dos.cuerpo.message)).toContain(
        'modificado por otra peticion',
      );

      // El rechazo tiene que dejar la fila como estaba, no aplicar el segundo cambio.
      const despues = await llamar(app, 'GET', `/empleados/${empleadoId}`, {
        token: rrhh,
      });
      expect(despues.cuerpo.tipo_contrato).toBe('PRACTICAS');
      expect(Number(despues.cuerpo.version)).toBe(Number(uno.cuerpo.version));
    });

    it('sin version, el PATCH sigue funcionando como ultimo que escribe gana', async () => {
      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { tipo_contrato: 'PLANTA' },
      });

      expect(respuesta.estado).toBe(200);
    });
  });

  describe('6. Anular un campo opcional', () => {
    it('codigo, salario e IBAN a null se guardan como NULL', async () => {
      const respuesta = await llamar(app, 'PATCH', `/empleados/${empleadoId}`, {
        token: rrhh,
        cuerpo: { codigo: null, salario: null, iban: null },
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.codigo).toBeNull();
      expect(respuesta.cuerpo.salario).toBeNull();
      expect(respuesta.cuerpo.iban).toBeNull();

      const fila = await empleadoEnBruto(empleadoId);

      // No basta con que la API lo devuelva nulo: si la fila guardase el valor
      // anterior, el siguiente listado lo devolveria otra vez.
      expect(fila.codigo).toBeNull();
      expect(fila.salario_cifrado).toBeNull();
      expect(fila.iban_cifrado).toBeNull();
      expect(fila.iban_indice).toBeNull();
    });

    it('el indice del IBAN se libera al anularlo, para reutilizar la cuenta', async () => {
      const reutilizable = await llamar(
        app,
        'GET',
        `/empleados?iban=${encodeURIComponent(IBAN)}`,
        { token: rrhh },
      );

      expect(reutilizable.estado).toBe(200);
      expect(reutilizable.cuerpo.total).toBe(0);
    });
  });

  describe('7. Backfill de documentos que quedaron en claro', () => {
    /**
     * Inserta una persona con el documento en claro, como quedo antes de la migracion.
     *
     * Se escribe con SQL directo porque por la API es imposible: el servicio cifra al
     * guardar, y una fila en claro solo se puede fabricar a mano. Es exactamente el
     * estado que deja `migration:run` si alguien no lanza despues `cifrar-datos`.
     */
    async function personaEnClaro(documento: string): Promise<string> {
      const id = randomUUID();
      registrarPersona(id);

      await consultar(
        conexion,
        `INSERT INTO persona
           (id, tipo_documento, numero_documento, nombres, apellidos)
         VALUES (?, 'CC', ?, 'Persona', ?)`,
        [id, documento, `Backfill ${SUFIJO}`],
      );

      return id;
    }

    it('convierte la fila, calcula su indice y la deja localizable', async () => {
      const numero = `CC-BACKFILL-${SUFIJO}`;
      const id = await personaEnClaro(numero);

      const resultado = await cifrarDocumentos();

      // El recuento se compara sobre la fila propia y no sobre el total del script: el
      // script recorre `persona` entera y cualquier fila pendiente de otra suite
      // inflaria el numero.
      expect(resultado.incompatibles.join(' ')).not.toContain(id);

      const fila = await personaEnBruto(id);
      expect(String(fila.numero_documento)).toMatch(/^v1:/);
      expect(fila.numero_documento).not.toBe(numero);
      expect(fila.documento_indice).toBe(
        new CifradoService().indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, numero),
      );

      // El indice no basta con estar escrito: tiene que servir para encontrarla, que es
      // lo que evita el certificado de que el cifrado dejo la tabla inutilizable.
      const busqueda = await llamar(
        app,
        'GET',
        `/personas?numero_documento=${encodeURIComponent(numero)}`,
        { token: rrhh },
      );

      expect(busqueda.estado).toBe(200);
      expect(busqueda.cuerpo.total).toBe(1);
      expect(busqueda.cuerpo.datos[0].numero_documento).toBe(numero);
    });

    it('es idempotente: una segunda pasada no vuelve a tocar nada', async () => {
      const resultado = await cifrarDocumentos();

      expect(resultado.convertidas).toBe(0);
      expect(resultado.incompatibles).toHaveLength(0);
    });

    it('avisa de los documentos repetidos en vez de cifrarlos a la fuerza', async () => {
      const numero = `CC-REPETIDO-${SUFIJO}`;
      const uno = await personaEnClaro(numero);
      const otro = await personaEnClaro(numero);

      const resultado = await cifrarDocumentos();

      // El script no puede decidir cual de las dos se queda, asi que convierte una y
      // deja la otra en claro, avisando. Cifrarlas las dos haria saltar el UNIQUE del
      // indice, y saltarlo a proposito no es una opcion.
      expect(resultado.convertidas).toBe(1);

      const aviso = resultado.incompatibles.join(' ');
      expect(aviso).toContain('CC-REPETIDO');
      expect(aviso).toMatch(new RegExp(`${uno}|${otro}`));

      const pendiente = await Promise.all(
        [uno, otro].map((id) => personaEnBruto(id)),
      );
      const enClaro = pendiente.filter((f) => f.documento_indice === null);
      expect(enClaro).toHaveLength(1);
      expect(enClaro[0].numero_documento).toBe(numero);
    });
  });

  describe('8. Permisos de los datos sensibles', () => {
    const IBAN_EMPRESA_B = 'ES9121000418450200050001';
    const SALARIO_EMPRESA_B = 31200.75;

    let personaB: string;
    let empleadoB: string;

    beforeAll(async () => {
      personaB = await crearPersona('SENSB');

      // La fila se inserta con SQL porque hace falta un empleado en la empresa B y el
      // token de RRHH solo escribe en la A. Se cifra con el mismo servicio que usa la
      // aplicacion: si el texto no cumpliera el formato, la columna lo aceptaria y la
      // lectura reventaria al descifrar.
      empleadoB = randomUUID();
      registrarEmpleado(empleadoB);

      const cifrado = new CifradoService();
      await consultar(
        conexion,
        `INSERT INTO empleado
           (id, empresa_id, persona_id, tipo_contrato, fecha_ingreso,
            salario_cifrado, iban_cifrado, iban_indice)
         VALUES (?, ?, ?, 'PLANTA', '2026-02-01', ?, ?, ?)`,
        [
          empleadoB,
          IDS_PRUEBA.empresaB,
          personaB,
          cifrado.cifrar(String(SALARIO_EMPRESA_B)),
          cifrado.cifrar(IBAN_EMPRESA_B),
          cifrado.indiceCiego(CONTEXTO_IBAN_EMPLEADO, IBAN_EMPRESA_B),
        ],
      );
    });

    it('un rol con el permiso ve el salario y el IBAN', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.leer', PERMISO_SENSIBLES],
        async (token) => {
          const respuesta = await llamar(
            app,
            'GET',
            `/empleados/${empleadoB}`,
            {
              token,
            },
          );

          expect(respuesta.estado).toBe(200);
          expect(respuesta.cuerpo.salario).toBe(SALARIO_EMPRESA_B);
          expect(respuesta.cuerpo.iban).toBe(IBAN_EMPRESA_B);
        },
      );
    });

    it('sin el permiso, los campos no aparecen: no vienen a null', async () => {
      // El rol EMPLEADO tiene `empleado.leer`, asi que entra al endpoint. Lo que no tiene
      // es el permiso de ver los datos sensibles.
      const token = await tokenEmpleado(app);
      const respuesta = await llamar(app, 'GET', `/empleados/${empleadoB}`, {
        token,
      });

      expect(respuesta.estado).toBe(200);

      // Ausentes, y no `null`: un `null` afirmaria que ese empleado no tiene salario, que
      // es una verdad sobre la fila y no sobre quien pregunta.
      expect('salario' in respuesta.cuerpo).toBe(false);
      expect('iban' in respuesta.cuerpo).toBe(false);

      // El resto del empleado sigue visible: de lo que se trata es del dato sensible, no
      // de ocultar la fila entera.
      expect(respuesta.cuerpo.tipo_contrato).toBe('PLANTA');
    });

    it('el listado tampoco incluye los datos sensibles sin el permiso', async () => {
      const respuesta = await llamar(app, 'GET', '/empleados', {
        token: await tokenEmpleado(app),
      });

      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo.total).toBe(1);
      expect('salario' in respuesta.cuerpo.datos[0]).toBe(false);
      expect('iban' in respuesta.cuerpo.datos[0]).toBe(false);
    });

    it('escribir un dato sensible sin permiso responde 403 y no cambia nada', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.actualizar'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'PATCH',
            `/empleados/${empleadoB}`,
            {
              token,
              cuerpo: { salario: 40000 },
            },
          );

          expect(respuesta.estado).toBe(403);
          expect(respuesta.cuerpo.message).toContain(PERMISO_SENSIBLES);
        },
      );

      // Aceptar el 403 y escribir el cambio seria peor que no comprobar nada: quien no
      // puede ver el dato tampoco podria deshacerlo.
      //
      // Se compara el valor DESCIFRADO, no el texto guardado: cada cifrado usa un IV
      // aleatorio, asi que el mismo salario produce un texto distinto cada vez y
      // comparar las cadenas solo probaria que el IV cambia.
      const fila = await empleadoEnBruto(empleadoB);
      expect(new CifradoService().descifrar(String(fila.salario_cifrado))).toBe(
        String(SALARIO_EMPRESA_B),
      );
    });

    it('sin el permiso, el resto de campos se puede tocar con normalidad', async () => {
      await conPermisosTemporales(
        conexion,
        app,
        ['empleado.actualizar'],
        async (token) => {
          const respuesta = await llamar(
            app,
            'PATCH',
            `/empleados/${empleadoB}`,
            {
              token,
              cuerpo: { tipo_contrato: 'PRACTICAS' },
            },
          );

          expect(respuesta.estado).toBe(200);
          expect(respuesta.cuerpo.tipo_contrato).toBe('PRACTICAS');
        },
      );
    });
  });
});
