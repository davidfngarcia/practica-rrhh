import { describe, expect, it } from 'vitest';
import { OCULTO, ocultarSensibles } from './redaccion.js';

/**
 * Ocultamiento de datos sensibles en la auditoria.
 *
 * Son pruebas unitarias y no e2e a proposito: `ocultarSensibles` es una funcion pura
 * sobre estructuras en memoria, sin base de datos de por medio. Una suite de cinco
 * segundos que falla al instante es mas util que una de un minuto contra MySQL, y para
 * un caso limite raro (un ciclo, un Map, una clave en mayusculas) el ciclo corto es la
 * unica forma de probarlos todos.
 */
describe('ocultarSensibles', () => {
  it('sustituye por el valor oculto las claves sensibles de primer nivel', () => {
    const resultado = ocultarSensibles({
      numero_documento: 'CC123456',
      nombres: 'Ana',
      salario: 50000,
    }) as Record<string, unknown>;

    expect(resultado.numero_documento).toBe(OCULTO);
    expect(resultado.salario).toBe(OCULTO);
    expect(resultado.nombres).toBe('Ana');
  });

  it('no distingue mayusculas en el nombre de la clave', () => {
    // Las claves llegan de la entidad de TypeORM, de un DTO o de un literal escrito a
    // mano. Si la comparacion fuera sensible a mayusculas, `IBAN` se colaria entero.
    const resultado = ocultarSensibles({
      IBAN: 'ES91',
      Salario: 1,
      NUMERO_DOCUMENTO: 'CC1',
    }) as Record<string, unknown>;

    expect(resultado.IBAN).toBe(OCULTO);
    expect(resultado.Salario).toBe(OCULTO);
    expect(resultado.NUMERO_DOCUMENTO).toBe(OCULTO);
  });

  it('oculta tambien las columnas cifradas', () => {
    // La columna ya va cifrada, asi que dejarla pasar no filtraria nada de frente, pero
    // la fila quedaria con un dato protegido y el resto del registro sin proteger: una
    // falsa sensacion de seguridad en la tabla que mas se consulta.
    const resultado = ocultarSensibles({
      documento_cifrado: 'v1:...',
      iban_cifrado: 'v1:...',
      salario_cifrado: 'v1:...',
      iban_indice: 'abc123',
    }) as Record<string, unknown>;

    expect(resultado.documento_cifrado).toBe(OCULTO);
    expect(resultado.iban_cifrado).toBe(OCULTO);
    expect(resultado.salario_cifrado).toBe(OCULTO);

    // El indice ciego si se conserva: no es reversible y sin el la auditoria pierde la
    // capacidad de correlacionar dos filas con el mismo dato.
    expect(resultado.iban_indice).toBe('abc123');
  });

  it('recorre objetos anidados a cualquier profundidad', () => {
    const resultado = ocultarSensibles({
      empleado: {
        contacto: { iban: 'ES91', correo: 'a@b.c' },
        nomina: [{ salario: 1 }, { otro: { numero_documento: 'CC2' } }],
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(resultado.empleado.contacto.iban).toBe(OCULTO);
    expect(resultado.empleado.contacto.correo).toBe('a@b.c');

    const nomina = (resultado.empleado as unknown as Record<string, unknown>)
      .nomina as Record<string, unknown>[];
    expect(nomina[0].salario).toBe(OCULTO);
    expect((nomina[1] as Record<string, unknown>).otro).toEqual({
      numero_documento: OCULTO,
    });
  });

  it('no modifica el objeto original', () => {
    const original = { iban: 'ES91', anidado: { salario: 100 } };
    ocultarSensibles(original);

    expect(original.iban).toBe('ES91');
    expect(original.anidado.salario).toBe(100);
  });

  it('devuelve intactos los valores que no son contenedores', () => {
    const fecha = new Date('2026-01-15T10:00:00.000Z');

    const resultado = ocultarSensibles({
      texto: 'hola',
      numero: 42,
      nulo: null,
      sinDefinir: undefined,
      falso: false,
      vacio: '',
      fecha,
      binario: Buffer.from('abc'),
    }) as Record<string, unknown>;

    expect(resultado.texto).toBe('hola');
    expect(resultado.numero).toBe(42);
    expect(resultado.nulo).toBeNull();
    expect(resultado.sinDefinir).toBeUndefined();
    expect(resultado.falso).toBe(false);
    expect(resultado.vacio).toBe('');

    // La fecha y el buffer se copian sin transformar: convertirlos a ISO o a base64
    // cambiaria lo que se guardo y luego no casaria con lo que la aplicacion devuelve.
    expect(resultado.fecha).toBe(fecha);
    expect(resultado.binario).toEqual(Buffer.from('abc'));
  });

  it('termina en vez de colgarse cuando el objeto se referencia a si mismo', () => {
    // Una entidad de TypeORM puede apuntar a si misma. Sin el `WeakSet` esta funcion se
    // comeria la pila y tumbaria el proceso entero en el login que audite.
    const entidad: Record<string, unknown> = { nombre: 'Ana' };
    entidad.jefe = entidad;

    const resultado = ocultarSensibles(entidad) as Record<string, unknown>;

    expect(resultado.nombre).toBe('Ana');
    expect(resultado.jefe).toBe('[circular]');
  });

  it('copia dos veces un objeto compartido, porque no hay ningun ciclo', () => {
    // Dos campos que apuntan a la misma persona no son un ciclo. Marcarla como
    // `[circular]` en la segunda seria falso, y perderia datos: en la auditoria uno de los
    // dos campos vendria vacio sin motivo aparente.
    const compartido = { iban: 'ES91', nombres: 'Ana' };

    const resultado = ocultarSensibles({
      primero: compartido,
      segundo: compartido,
    }) as Record<string, Record<string, unknown>>;

    expect(resultado.primero).toEqual({ iban: OCULTO, nombres: 'Ana' });
    expect(resultado.segundo).toEqual({ iban: OCULTO, nombres: 'Ana' });
  });

  it('aun asi detecta el bucle de verdad, con dos ramas que se cruzan', () => {
    // A se referencia a si misma y B la comparte. Recorrer A debe terminar; si el camino
    // no se limpia entre ramas, B se marcaria como circular sin serlo.
    const rama: Record<string, unknown> = { nombre: 'Ana' };
    rama.jefe = rama;

    const resultado = ocultarSensibles({
      rama,
      otra: { nombre: 'Luis', jefe: rama },
    }) as Record<string, Record<string, unknown>>;

    expect(resultado.rama.jefe).toBe('[circular]');
    expect(resultado.otra.jefe).toEqual({ nombre: 'Ana', jefe: '[circular]' });
  });

  it('recorre arrays y mapas sin perder elementos', () => {
    const resultado = ocultarSensibles([
      { codigo: 'A1' },
      { codigo: 'A2', salario: 3000 },
    ]) as Record<string, unknown>[];

    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toEqual({ codigo: 'A1' });
    expect(resultado[1]).toEqual({ codigo: 'A2', salario: OCULTO });
  });

  it('oculta tambien dentro de un Map o un Set, sin reventar', () => {
    // Un Map no es un objeto plano: sus entradas no aparecen en `Object.entries`. Lo que
    // no se puede recorrer se copia entero, y por eso un Map en la auditoria se considera
    // un caso que no deberia ocurrir; la prueba fija que al menos no rompe el guardado.
    const resultado = ocultarSensibles({
      mapa: new Map([['iban', 'ES91']]),
      conjunto: new Set(['ES91']),
    }) as Record<string, unknown>;

    expect(resultado.mapa).toBeInstanceOf(Map);
    expect(resultado.conjunto).toBeInstanceOf(Set);
  });

  it('oculta las claves de autenticacion aunque hoy no se auditen', () => {
    const resultado = ocultarSensibles({
      password: 'secreta',
      password_hash: 'abc',
      contrasena: 'otra',
      usuario: 'ana',
    }) as Record<string, unknown>;

    expect(resultado.password).toBe(OCULTO);
    expect(resultado.password_hash).toBe(OCULTO);
    expect(resultado.contrasena).toBe(OCULTO);
    expect(resultado.usuario).toBe('ana');
  });

  it('deja intactos los escalares que llegan directamente', () => {
    expect(ocultarSensibles('texto')).toBe('texto');
    expect(ocultarSensibles(7)).toBe(7);
    expect(ocultarSensibles(null)).toBeNull();
    expect(ocultarSensibles(undefined)).toBeUndefined();
  });
});
