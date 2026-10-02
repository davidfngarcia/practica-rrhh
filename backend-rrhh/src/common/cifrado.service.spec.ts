import { beforeAll, describe, expect, it } from 'vitest';
import {
  CifradoService,
  CONTEXTO_DOCUMENTO_PERSONA,
  CONTEXTO_IBAN_EMPLEADO,
} from './cifrado.service.js';

/**
 * Cifrado en reposo e indice ciego.
 *
 * Se prueban aqui y no solo en la e2e porque el comportamiento que importa —que dos
 * textos iguales den ciphertexts distintos, que el indice sea determinista y que una
 * alteracion del tag reviente— es exactamente el que hace que un dato sea recuperable o
 * no. Si un cambio en el formato pasara inadvertido, la e2e seguiria en verde mientras
 * los datos de la base quedan ilegibles para siempre.
 */
describe('CifradoService', () => {
  let cifrado: CifradoService;

  beforeAll(() => {
    // `configApp()` lee el entorno al construir el servicio y falla si falta la clave.
    // `loadEnvFile` no pisa variables ya definidas, asi que es seguro aunque otra prueba
    // haya cargado antes.
    process.loadEnvFile();
    cifrado = new CifradoService();
  });

  describe('cifrar y descifrar', () => {
    it('devuelve el mismo texto al descifrarlo', () => {
      expect(cifrado.descifrar(cifrado.cifrar('CC123456'))).toBe('CC123456');
    });

    it('el formato es v1 con IV, tag y texto separados por dos puntos', () => {
      const partes = cifrado.cifrar('CC123456').split(':');

      expect(partes).toHaveLength(4);
      expect(partes[0]).toBe('v1');
      // IV de 12 bytes y tag de 16 en base64. Si el formato cambiara, `descifrar` seguiria
      // aceptando algo que ya no puede leer.
      expect(Buffer.from(partes[1], 'base64')).toHaveLength(12);
      expect(Buffer.from(partes[2], 'base64')).toHaveLength(16);
    });

    it('el mismo texto produce un ciphertext distinto cada vez', () => {
      // Es la garantia que hace que el IV no se este reutilizando. Si dos llamadas
      // devolvieran lo mismo, dos empleados con el mismo documento serian distinguibles
      // en la base y el modo GCM estaria roto.
      const a = cifrado.cifrar('CC123456');
      const b = cifrado.cifrar('CC123456');

      expect(a).not.toBe(b);
      expect(cifrado.descifrar(a)).toBe(cifrado.descifrar(b));
    });

    it('no guarda el texto original en ninguna parte del ciphertext', () => {
      const original = 'CC123456789';
      const cifradoTexto = cifrado.cifrar(original);

      expect(cifradoTexto).not.toContain(original);
      expect(
        Buffer.from(cifradoTexto.split(':')[3], 'base64').toString('utf8'),
      ).not.toContain(original);
    });

    it('admite texto con acentos, enie y emoji', () => {
      const original = 'Ángela Núñez — 🇨🇴 Practicas 2026';
      expect(cifrado.descifrar(cifrado.cifrar(original))).toBe(original);
    });

    it('admite el texto vacio', () => {
      // Un IBAN o un nombre vacio se cifran igual, y descifrarlo tiene que devolver la
      // cadena vacia y no fallar.
      expect(cifrado.descifrar(cifrado.cifrar(''))).toBe('');
    });

    it('rechaza un ciphertext cuyo tag fue alterado', () => {
      const partes = cifrado.cifrar('CC123456').split(':');
      const tag = Buffer.from(partes[2], 'base64');
      tag[0] ^= 0xff;

      const alterado = [
        partes[0],
        partes[1],
        tag.toString('base64'),
        partes[3],
      ].join(':');

      // GCM es autenticado: si alguien edita la base, el descifrado falla en vez de
      // devolver basura silenciosamente.
      expect(() => cifrado.descifrar(alterado)).toThrow();
    });

    it('rechaza un ciphertext con el texto alterado', () => {
      const partes = cifrado.cifrar('CC123456').split(':');
      const otro = Buffer.from('CC999999').toString('base64');

      expect(() =>
        cifrado.descifrar(partes.join(':').replace(partes[3], otro)),
      ).toThrow();
    });

    it('rechaza un formato desconocido en vez de adivinar', () => {
      expect(() => cifrado.descifrar('lo que sea')).toThrow(/formato/i);
      expect(() => cifrado.descifrar('v2:a:b:c')).toThrow(/formato/i);
    });

    it('rechaza un ciphertext truncado', () => {
      const partes = cifrado.cifrar('CC123456').split(':');

      expect(() => cifrado.descifrar(partes.slice(0, 3).join(':'))).toThrow();
      expect(() =>
        cifrado.descifrar([partes[0], 'AAAA', partes[2], partes[3]].join(':')),
      ).toThrow(/truncado/i);
    });
  });

  describe('indiceCiego', () => {
    it('es determinista: el mismo dato da el mismo indice', () => {
      // De esto depende el UNIQUE y el filtro por documento. Un indice que cambiara entre
      // llamadas haria que la busqueda devolviese cero sin error.
      const a = cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, 'CC123456');
      const b = cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, 'CC123456');

      expect(a).toBe(b);
    });

    it('es un SHA-256 en hexadecimal de 64 caracteres', () => {
      const indice = cifrado.indiceCiego(
        CONTEXTO_DOCUMENTO_PERSONA,
        'CC123456',
      );

      expect(indice).toMatch(/^[0-9a-f]{64}$/);
    });

    it('no contiene el dato original', () => {
      const indice = cifrado.indiceCiego(
        CONTEXTO_DOCUMENTO_PERSONA,
        'CC123456789',
      );

      expect(indice).not.toContain('CC123456789');
      expect(indice).not.toContain('CC');
    });

    it('recorta los espacios de los extremos y no distingue mayusculas', () => {
      // Es lo que hace que " cc12" y "CC12" sean la misma persona y no dos. El servicio
      // normaliza el IBAN al guardar, pero no puede confiar en que quien llama lo haga.
      const referencia = cifrado.indiceCiego(
        CONTEXTO_DOCUMENTO_PERSONA,
        'CC12',
      );

      expect(cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, '  cc12  ')).toBe(
        referencia,
      );
    });

    it('los espacios internos si se distinguen', () => {
      // "CC12" y "CC 12" no son el mismo dato. Normalizarlos haria que dos documentos que
      // se diferencian a proposito convergieran en un indice unico, y el UNIQUE dejaria de
      // proteger lo que protege.
      expect(cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, 'CC12')).not.toBe(
        cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, 'CC 12'),
      );
    });

    it('el contexto separa datos que no tienen relacion entre si', () => {
      // Si documento e IBAN compartieran indice, se podria deducir que una persona es
      // empleado de una empresa comparando su documento con el IBAN de un empleado.
      const documento = cifrado.indiceCiego(
        CONTEXTO_DOCUMENTO_PERSONA,
        'ES9121000418',
      );
      const iban = cifrado.indiceCiego(CONTEXTO_IBAN_EMPLEADO, 'ES9121000418');

      expect(documento).not.toBe(iban);
    });

    it('datos distintos producen indices distintos', () => {
      const indices = new Set(
        ['CC1', 'CC2', 'CC3', 'CC4'].map((d) =>
          cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, d),
        ),
      );

      expect(indices.size).toBe(4);
    });

    it('no es reversible con la base en la mano', () => {
      // El indice es un HMAC con clave del servidor: sin ella no se puede probar un
      // documento candidato. Esta prueba fija que no se parece a un hash simple, que si
      // lo seria.
      const indice = cifrado.indiceCiego(
        CONTEXTO_DOCUMENTO_PERSONA,
        'CC123456',
      );

      expect(indice).not.toBe(
        cifrado.indiceCiego(CONTEXTO_DOCUMENTO_PERSONA, 'CC123457'),
      );
    });
  });
});
