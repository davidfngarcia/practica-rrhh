import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { SesionActual } from '../auth/sesion.decorator.js';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CifradoService } from '../common/cifrado.service.js';
import { conflicto, noEncontrado } from '../common/errores.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import { patronBusqueda } from '../common/paginacion.js';
import { Empleado } from '../database/entities/empleado.entity.js';
import { Persona } from '../database/entities/persona.entity.js';
import type {
  ActualizarPersonaDto,
  CrearPersonaDto,
  ListarPersonasDto,
} from './persona.dto.js';

/** Forma que devuelve la API, sin las columnas internas de la tabla. */
export interface PersonaRespuesta {
  id: string;
  tipo_documento: string;
  numero_documento: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string | null;
  genero: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Contexto del indice ciego del documento. Separa el indice de las personas del de los
 * IBAN de los empleados: mismo HMAC, distinto dato, porque una clave de indice
 * reutilizada en dos columnas permitiria correlacionar un documento con una cuenta.
 */
const CONTEXTO_DOCUMENTO = 'persona.numero_documento';

/**
 * Personas: catalogo global de personas naturales.
 *
 * A diferencia de departamentos y puestos, `persona` NO tiene `empresa_id`. Una persona
 * es la misma en cualquier empresa: el mismo Seres humano no tiene una ficha distinta
 * por la empresa en la que trabaja. El vinculo con una empresa lo establece `empleado`,
 * que si es multitenant.
 *
 * La consecuencia practica es que aqui no hay nada que filtrar por empresa: quien
 * tenga `persona.leer` ve el catalogo completo, y quien tenga `persona.crear` puede
 * dar de alta a una persona que luego se usara en cualquier empresa. Es una decision de
 * modelado, no un descuido, y por eso se repite aqui en lugar de dejar que se lea como
 * una ausencia.
 *
 * El numero de documento se cifra al entrar y se descifra al salir, de modo que en la
 * tabla nunca esta en claro. Por dentro la busqueda va contra `documento_indice`, no
 * contra la columna cifrada: ver `indiceDe`.
 */
@Injectable()
export class PersonasService {
  constructor(
    @InjectRepository(Persona)
    private readonly personas: Repository<Persona>,
    // Necesario para comprobar que una persona no se da de baja mientras haya
    // empleados que la referencian: la FK es RESTRICT y el error de MySQL no seria
    // entendible.
    @InjectRepository(Empleado)
    private readonly empleados: Repository<Empleado>,
    private readonly auditoria: AuditoriaService,
    private readonly cifrado: CifradoService,
  ) {}

  /**
   * Listado del catalogo de personas.
   *
   * A diferencia de los catalogos de empresa, aqui no se filtra por `empresa_id`: ver el
   * comentario de la clase.
   */
  async listar(
    filtros: ListarPersonasDto,
  ): Promise<RespuestaPaginada<PersonaRespuesta>> {
    const consulta = this.personas.createQueryBuilder('persona');

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('persona.activo = :activo', { activo: true });
    }

    if (filtros.numero_documento?.trim()) {
      // Sobre el indice ciego, no sobre `numero_documento`: la columna esta cifrada con
      // un IV aleatorio, asi que ahi no hay igualdad que buscar. El indice si es
      // determinista, que es justo lo que permite el filtro exacto.
      consulta.andWhere('persona.documento_indice = :indice', {
        indice: this.indiceDe(filtros.numero_documento),
      });
    }

    if (filtros.tipo_documento) {
      consulta.andWhere('persona.tipo_documento = :tipo', {
        tipo: filtros.tipo_documento,
      });
    }

    if (filtros.genero) {
      consulta.andWhere('persona.genero = :genero', { genero: filtros.genero });
    }

    if (filtros.buscar?.trim()) {
      // El nombre completo se busca tambien en un solo campo porque el cliente suele
      // escribir "Garcia Lopez" sin saber en que columna va cada parte.
      //
      // `numero_documento` no aparece en este bloque a proposito: al estar cifrado, un
      // LIKE buscaria sobre el texto cifrado y no encontraria nada. Quien busca por
      // documento usa el filtro exacto de arriba, que va por el indice ciego. Es la
      // consecuencia directa de no guardar el documento en claro.
      consulta.andWhere(
        `(
           persona.nombres LIKE :patron ESCAPE '\\\\'
           OR persona.apellidos LIKE :patron ESCAPE '\\\\'
           OR persona.email LIKE :patron ESCAPE '\\\\'
           OR CONCAT(persona.nombres, ' ', persona.apellidos) LIKE :patron ESCAPE '\\\\'
         )`,
        { patron: patronBusqueda(filtros.buscar) },
      );
    }

    // El `id` desempata: sin un orden totalmente definido, dos peticiones iguales
    // podrian devolver los mismos elementos en paginas distintas.
    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('persona.apellidos', 'ASC')
      .addOrderBy('persona.nombres', 'ASC')
      .addOrderBy('persona.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: filas.map((p) => this.aRespuesta(p)),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  /** Una persona concreta, o 404 si no existe. */
  async obtener(id: string): Promise<PersonaRespuesta> {
    return this.aRespuesta(await this.buscar(id));
  }

  async crear(
    sesion: SesionActual,
    dto: CrearPersonaDto,
    contexto?: ContextoPeticion,
  ): Promise<PersonaRespuesta> {
    await this.comprobarDocumentoLibre(dto.numero_documento);

    const nueva: Partial<Persona> = {
      id: crypto.randomUUID(),
      tipo_documento: dto.tipo_documento,
      // Se cifra aqui, en la frontera. A partir de este punto la columna contiene texto
      // cifrado y nadie mas debe escribirla.
      numero_documento: this.cifrado.cifrar(dto.numero_documento),
      documento_indice: this.indiceDe(dto.numero_documento),
      nombres: dto.nombres,
      apellidos: dto.apellidos,
      // La columna es `date` y las demas son `NOT NULL`: lo opcional se escribe como
      // `null` explicito y no se omite, que en MySQL seria indistinguible.
      fecha_nacimiento: dto.fecha_nacimiento ?? null,
      genero: dto.genero ?? null,
      email: dto.email ?? null,
      telefono: dto.telefono ?? null,
      direccion: dto.direccion ?? null,
      activo: dto.activo ?? true,
      created_by: { id: sesion.sub } as Persona['created_by'],
      updated_by: { id: sesion.sub } as Persona['updated_by'],
    };

    const guardada = await this.personas.save(nueva);
    const respuesta = this.aRespuesta(guardada);

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'persona',
        entidad_id: guardada.id,
        datos_despues: respuesta as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return respuesta;
  }

  async actualizar(
    sesion: SesionActual,
    id: string,
    dto: ActualizarPersonaDto,
    contexto?: ContextoPeticion,
  ): Promise<PersonaRespuesta> {
    const actual = await this.buscar(id);
    const antes = this.aRespuesta(actual);

    if (dto.numero_documento !== undefined) {
      await this.comprobarDocumentoLibre(dto.numero_documento, id);
    }

    // Solo se tocan los campos que llegan: un PATCH con `{ activo: false }` no debe
    // vaciar el correo.
    const cambios: Partial<Persona> = {
      updated_by: { id: sesion.sub } as Persona['updated_by'],
    };

    if (dto.numero_documento !== undefined) {
      // El documento es la identidad de la persona, asi que cambiarlo obliga a rehacer
      // las dos columnas: el texto cifrado y su indice. Si solo se re-cifrara el texto y
      // el indice se quedara con el valor anterior, la persona pasaria a ocupar un
      // documento que ya no es el suyo y ademas dejaria libre el anterior.
      cambios.numero_documento = this.cifrado.cifrar(dto.numero_documento);
      cambios.documento_indice = this.indiceDe(dto.numero_documento);
    }
    if (dto.nombres !== undefined) cambios.nombres = dto.nombres;
    if (dto.apellidos !== undefined) cambios.apellidos = dto.apellidos;
    if (dto.fecha_nacimiento !== undefined)
      cambios.fecha_nacimiento = dto.fecha_nacimiento;
    if (dto.genero !== undefined) cambios.genero = dto.genero;
    if (dto.email !== undefined) cambios.email = dto.email;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    if (dto.direccion !== undefined) cambios.direccion = dto.direccion;
    if (dto.activo !== undefined) cambios.activo = dto.activo;

    // `save()` con un objeto parcial devuelve solo los campos enviados: el PATCH
    // respondería sin el resto, y la auditoría guardaria un estado posterior
    // incompleto. `preload()` parte de la fila completa y devuelve la entidad entera.
    const preparada = await this.personas.preload({
      ...cambios,
      id: actual.id,
    });

    // `preload()` solo devuelve `undefined` si la fila ya no existe, y `buscar` la acaba
    // de encontrar. El guardia esta para que TypeScript lo contemple.
    if (!preparada) throw noEncontrado('la persona', id);

    const guardada = await this.personas.save(preparada);
    const despues = this.aRespuesta(guardada);

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'persona',
        entidad_id: id,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  /**
   * Baja logica: marca `deleted_at` y desactiva la persona.
   *
   * Se rechaza si tiene empleados, y se cuentan tambien los dados de baja: la FK es
   * RESTRICT y la fila del empleado sigue existiendo aunque este eliminada, asi que
   * borrarla dejaria al empleado apuntando a una persona que ya no esta. MySQL lo
   * impediria con su propio error, pero en ingles y con un codigo que no explica el
   * motivo.
   *
   * El indice unico `uq_persona_documento` usa la columna generada
   * `documento_indice_vigente`, que pasa a NULL en las filas borradas: asi el documento
   * queda libre para reutilizar. Al estar el documento cifrado, el indice ciego es la
   * unica forma de reconocerlo, y por eso la liberacion depende de que el UNIQUE mire
   * la columna generada y no el indice en si mismo.
   */
  async eliminar(
    sesion: SesionActual,
    id: string,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    const actual = await this.buscar(id);

    const empleados = await this.empleados.count({
      where: { persona_id: { id } as Empleado['persona_id'] },
    });

    if (empleados > 0) {
      throw conflicto(
        `La persona tiene ${empleados} ${empleados === 1 ? 'empleado asociado' : 'empleados asociados'} y no puede darse de baja`,
      );
    }

    // `repository.softDelete()` no permite escribir `activo` ni `updated_by` en la misma
    // sentencia, que es justo lo que hace falta aqui.
    await this.personas.update(
      { id: actual.id },
      {
        deleted_at: new Date(),
        activo: false,
        updated_by: { id: sesion.sub } as Persona['updated_by'],
      },
    );

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'persona',
        entidad_id: id,
        datos_antes: this.aRespuesta(actual) as unknown as Record<
          string,
          unknown
        >,
      },
      contexto,
    );
  }

  /** Busca la persona por id. El filtro por empresa no aplica: el catalogo es global. */
  private async buscar(id: string): Promise<Persona> {
    const encontrada = await this.personas.findOne({ where: { id } });

    if (!encontrada) throw noEncontrado('la persona', id);

    return encontrada;
  }

  /**
   * Comprueba que el documento este libre.
   *
   * Va contra `documento_indice` porque `numero_documento` esta cifrado y no admite
   * comparacion. La normalizacion (mayusculas y sin espacios sobrantes) la hace el
   * indice, de modo que `CC 123` y `cc123` chocan igual que antes: el indice unico no
   * distingue entre mayusculas, y esta comprobacion tampoco puede hacerlo al margen.
   *
   * Se filtra por `deleted_at IS NULL` porque el UNIQUE esta sobre la columna generada
   * `documento_indice_vigente`, que pasa a NULL en las filas dadas de baja: su documento
   * quedaria disponible para reutilizar.
   *
   * La comprobacion no sustituye al indice unico: dos altas simultaneas pueden pasar
   * las dos por aqui, y en ese caso es la base de datos la que resuelve el choque.
   */
  private async comprobarDocumentoLibre(
    numeroDocumento: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.personas
      .createQueryBuilder('persona')
      .where('persona.documento_indice = :indice', {
        indice: this.indiceDe(numeroDocumento),
      })
      .andWhere('persona.deleted_at IS NULL')
      .getOne();

    if (existente && existente.id !== exceptoId) {
      throw conflicto(
        `Ya existe una persona con el numero de documento ${numeroDocumento}`,
      );
    }
  }

  /** Indice ciego del documento, que es como se busca y como se declara unico. */
  private indiceDe(numeroDocumento: string): string {
    return this.cifrado.indiceCiego(CONTEXTO_DOCUMENTO, numeroDocumento);
  }

  /** Proyecta la entidad a la forma que consume el frontend, descifrando el documento. */
  private aRespuesta(persona: Persona): PersonaRespuesta {
    return {
      id: persona.id,
      tipo_documento: persona.tipo_documento,
      numero_documento: this.cifrado.descifrar(persona.numero_documento),
      nombres: persona.nombres,
      apellidos: persona.apellidos,
      fecha_nacimiento: persona.fecha_nacimiento,
      genero: persona.genero,
      email: persona.email,
      telefono: persona.telefono,
      direccion: persona.direccion,
      activo: persona.activo,
      created_at: persona.created_at,
      updated_at: persona.updated_at,
    };
  }
}
