import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OptimisticLockVersionMismatchError, Repository } from 'typeorm';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { SesionActual } from '../auth/sesion.decorator.js';
import { CifradoService } from '../common/cifrado.service.js';
import {
  CONTEXTO_DOCUMENTO_PERSONA,
  CONTEXTO_IBAN_EMPLEADO,
} from '../common/cifrado.service.js';
import { conflicto, noEncontrado } from '../common/errores.js';
import { fechaAnteriorOIgual } from '../common/fechas.js';
import type { RespuestaPaginada } from '../common/paginacion.js';
import { patronBusqueda } from '../common/paginacion.js';
import { Departamento } from '../database/entities/departamento.entity.js';
import { Empleado } from '../database/entities/empleado.entity.js';
import { Persona } from '../database/entities/persona.entity.js';
import { Puesto } from '../database/entities/puesto.entity.js';
import type {
  ActualizarEmpleadoDto,
  CrearEmpleadoDto,
  ListarEmpleadosDto,
} from './empleado.dto.js';

/**
 * Permiso que habilita a ver y modificar salario e IBAN.
 *
 * Vive aqui y no en el controlador porque no lo aplica un guard: no condiciona una ruta
 * entera, sino dos propiedades de la respuesta y dos campos del cuerpo. El guard decide
 * si se entra a la ruta; esto decide que se ve una vez dentro.
 */
export const PERMISO_SENSIBLES = 'empleado.sensible.leer';

/** Forma que devuelve la API, sin las columnas internas de la tabla. */
export interface EmpleadoRespuesta {
  id: string;
  empresa_id: string;
  persona_id: string;
  departamento_id: string | null;
  puesto_id: string | null;
  codigo: string | null;
  tipo_contrato: string;
  fecha_ingreso: string;
  fecha_fin: string | null;
  /**
   * Salario e IBAN.
   *
   * Descifrados, pero solo si la sesion tiene `empleado.sensible.leer`. Sin ese permiso
   * las dos propiedades no aparecen en la respuesta, en vez de venir a `null`: ausente
   * significa "no puedes verlo", mientras que `null` significaria "este empleado no tiene
   * salario", que es una afirmacion sobre la fila y no sobre quien pregunta.
   */
  salario?: number | null;
  iban?: string | null;
  activo: boolean;
  /** Version de la fila, para que el cliente la mande en el siguiente PATCH. */
  version: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Empleados: el vinculo entre una persona del catalogo global y una empresa.
 *
 * Es el unico punto donde se cruzan las dos_dimsiones del modelo: `persona` no tiene
 * empresa y `departamento`/`puesto` si. Por eso aqui, y solo aqui, hay que comprobar
 * que las tres referencias existen, y que las dos últimas pertenecen a la empresa de la
 * sesion. Ver `comprobarReferencias()`.
 */
@Injectable()
export class EmpleadosService {
  constructor(
    @InjectRepository(Empleado)
    private readonly empleados: Repository<Empleado>,
    @InjectRepository(Persona)
    private readonly personas: Repository<Persona>,
    @InjectRepository(Departamento)
    private readonly departamentos: Repository<Departamento>,
    @InjectRepository(Puesto)
    private readonly puestos: Repository<Puesto>,
    private readonly auditoria: AuditoriaService,
    private readonly cifrado: CifradoService,
  ) {}

  /**
   * Listado de los empleados de la empresa de la sesion.
   *
   * Todas las consultas filtran por `empresa_id`. No es una comprobacion opcional: es lo
   * que impide que el rol RRHH de una empresa vea la nomina de otra.
   */
  async listar(
    sesion: SesionActual,
    filtros: ListarEmpleadosDto,
  ): Promise<RespuestaPaginada<EmpleadoRespuesta>> {
    const consulta = this.empleados
      .createQueryBuilder('empleado')
      .where('empleado.empresa_id = :empresaId', {
        empresaId: sesion.empresa_id,
      });

    if (!filtros.incluir_inactivos) {
      consulta.andWhere('empleado.activo = :activo', { activo: true });
    }

    if (filtros.persona_id) {
      consulta.andWhere('empleado.persona_id = :personaId', {
        personaId: filtros.persona_id,
      });
    }

    if (filtros.departamento_id) {
      consulta.andWhere('empleado.departamento_id = :departamentoId', {
        departamentoId: filtros.departamento_id,
      });
    }

    if (filtros.puesto_id) {
      consulta.andWhere('empleado.puesto_id = :puestoId', {
        puestoId: filtros.puesto_id,
      });
    }

    if (filtros.tipo_contrato) {
      consulta.andWhere('empleado.tipo_contrato = :tipo', {
        tipo: filtros.tipo_contrato,
      });
    }

    if (filtros.codigo?.trim()) {
      // El codigo va sobre `codigo_vigente`, que es NULL en las filas dadas de baja: se
      // filtra por codigo entre gente de alta, no por el codigo historico de alguien que
      // ya no esta. Es el mismo criterio que usa el UNIQUE `uq_empleado_codigo`.
      consulta.andWhere('empleado.codigo_vigente = :codigo', {
        codigo: filtros.codigo.trim(),
      });
    }

    // `vigente_en` filtra por el periodo del contrato, no por `activo`: un empleado con
    // contrato terminado sigue en la nomina historica, y lo que se pregunta es si
    // estaba de alta en esa fecha. Las dos comparaciones son de texto porque el formato
    // `AAAA-MM-DD` ordena igual que las fechas.
    if (filtros.vigente_en) {
      consulta.andWhere('empleado.fecha_ingreso <= :fecha', {
        fecha: filtros.vigente_en,
      });
      consulta.andWhere(
        '(empleado.fecha_fin IS NULL OR empleado.fecha_fin >= :fecha)',
        { fecha: filtros.vigente_en },
      );
    }

    // `persona` se une una sola vez y con `leftJoinAndSelect`, no solo para filtrar por
    // nombre sino tambien para poder leer su id al proyectar la respuesta. Sin ese
    // `select`, `empleado.persona_id` llega como `undefined` y la respuesta reventaria
    // con un 500.
    consulta.leftJoinAndSelect('empleado.persona_id', 'persona');
    consulta.leftJoinAndSelect('empleado.empresa_id', 'empresa');

    // El documento de la persona se filtra por su indice ciego, nunca por
    // `persona.numero_documento`: esa columna esta cifrada con un IV aleatorio, asi que
    // ahi no hay igualdad posible. El indice si es determinista.
    if (filtros.numero_documento?.trim()) {
      consulta.andWhere('persona.documento_indice = :documentoIndice', {
        documentoIndice: this.cifrado.indiceCiego(
          CONTEXTO_DOCUMENTO_PERSONA,
          filtros.numero_documento,
        ),
      });
    }

    // El IBAN se filtra por su indice ciego, con el mismo razonamiento que el documento:
    // `iban_cifrado` no admite igualdad ni busqueda por fragmento.
    if (filtros.iban?.trim()) {
      consulta.andWhere('empleado.iban_indice = :ibanIndice', {
        ibanIndice: this.cifrado.indiceCiego(
          CONTEXTO_IBAN_EMPLEADO,
          filtros.iban.trim(),
        ),
      });
    }

    if (filtros.buscar?.trim()) {
      // La busqueda por texto llega a las columnas de la persona, no a las del empleado:
      // quien busca "Garcia" quiere encontrar a quien se llama Garcia, y el nombre no
      // vive en la tabla de empleado.
      //
      // El documento no se incluye porque `persona.numero_documento` esta cifrado con un
      // IV aleatorio: un LIKE sobre el texto cifrado no encontraria a nadie y devolveria
      // un cero silencioso, que es peor que un 404. Para buscar por documento esta el
      // filtro exacto de `ListarEmpleadosDto`, que consulta `persona.documento_indice`.
      // Para buscar por codigo de empleado, `empleado.codigo`.
      consulta.andWhere(
        `(
           persona.nombres LIKE :patron ESCAPE '\\\\'
           OR persona.apellidos LIKE :patron ESCAPE '\\\\'
           OR empleado.codigo LIKE :patron ESCAPE '\\\\'
         )`,
        { patron: patronBusqueda(filtros.buscar) },
      );
    }

    // El `id` desempata: sin un orden totalmente definido, dos peticiones iguales
    // podrian devolver los mismos elementos en paginas distintas.
    const pagina = filtros.pagina;
    const porPagina = filtros.por_pagina;

    const [filas, total] = await consulta
      .orderBy('empleado.fecha_ingreso', 'DESC')
      .addOrderBy('empleado.id', 'ASC')
      .skip((pagina - 1) * porPagina)
      .take(porPagina)
      .getManyAndCount();

    return {
      datos: filas.map((e) => this.aRespuesta(sesion, e)),
      total,
      pagina,
      por_pagina: porPagina,
    };
  }

  /** Un empleado concreto de la empresa de la sesion, o 404 si no existe. */
  async obtener(sesion: SesionActual, id: string): Promise<EmpleadoRespuesta> {
    return this.aRespuesta(sesion, await this.buscar(sesion, id));
  }

  async crear(
    sesion: SesionActual,
    dto: CrearEmpleadoDto,
    contexto?: ContextoPeticion,
  ): Promise<EmpleadoRespuesta> {
    await this.comprobarReferencias(sesion.empresa_id, {
      persona_id: dto.persona_id,
      departamento_id: dto.departamento_id,
      puesto_id: dto.puesto_id,
    });

    this.comprobarFechas(dto.fecha_ingreso, dto.fecha_fin ?? null);

    this.comprobarEscrituraSensibles(
      sesion,
      { nombre: 'salario', enviado: dto.salario },
      { nombre: 'iban', enviado: dto.iban },
    );

    await this.comprobarVinculaLibre(sesion.empresa_id, dto.persona_id);

    if (dto.codigo !== undefined && dto.codigo !== null) {
      await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo);
    }

    const nuevo: Partial<Empleado> = {
      id: crypto.randomUUID(),
      // Las relaciones van como referencia con la PK: `{ id }` y no el UUID suelto.
      empresa_id: { id: sesion.empresa_id } as Empleado['empresa_id'],
      persona_id: { id: dto.persona_id } as Empleado['persona_id'],
      departamento_id: dto.departamento_id ?? null,
      puesto_id: dto.puesto_id ?? null,
      codigo: dto.codigo ?? null,
      tipo_contrato: dto.tipo_contrato ?? 'PLANTA',
      fecha_ingreso: dto.fecha_ingreso,
      fecha_fin: dto.fecha_fin ?? null,
      // Se cifran antes de escribir. El DTO los entrega como numero y como cadena, que es
      // lo que el cliente espera recibir tambien de vuelta.
      salario_cifrado:
        dto.salario === undefined || dto.salario === null
          ? null
          : this.cifrado.cifrar(String(dto.salario)),
      iban_cifrado:
        dto.iban === undefined || dto.iban === null
          ? null
          : this.cifrado.cifrar(dto.iban),
      iban_indice:
        dto.iban === undefined || dto.iban === null
          ? null
          : this.cifrado.indiceCiego(CONTEXTO_IBAN_EMPLEADO, dto.iban),
      activo: dto.activo ?? true,
      created_by: { id: sesion.sub } as Empleado['created_by'],
      updated_by: { id: sesion.sub } as Empleado['updated_by'],
    };

    const guardado = await this.empleados.save(nuevo);
    const respuesta = this.aRespuesta(sesion, guardado);

    await this.auditoria.auditar(
      {
        accion: 'CREAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'empleado',
        entidad_id: guardado.id,
        datos_despues: respuesta as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return respuesta;
  }

  async actualizar(
    sesion: SesionActual,
    id: string,
    dto: ActualizarEmpleadoDto,
    contexto?: ContextoPeticion,
  ): Promise<EmpleadoRespuesta> {
    this.comprobarEscrituraSensibles(
      sesion,
      { nombre: 'salario', enviado: dto.salario },
      { nombre: 'iban', enviado: dto.iban },
    );

    const actual = await this.buscar(sesion, id);
    const antes = this.aRespuesta(sesion, actual);

    // Solo se comprueban las referencias que llegan. Las que no, se quedan como estan
    // y por eso no se vuelven a validar: ya se validaron al crear la fila.
    if (dto.departamento_id !== undefined || dto.puesto_id !== undefined) {
      await this.comprobarReferencias(sesion.empresa_id, {
        persona_id: actual.persona_id.id,
        departamento_id: dto.departamento_id ?? undefined,
        puesto_id: dto.puesto_id ?? undefined,
      });
    }

    // El periodo se comprueba sobre el estado que quedara, no solo sobre lo enviado: un
    // PATCH que mueve la fecha de fin a antes del ingreso dejaria el empleado con un
    // contrato imposible, y el CHECK de la base lo rechazaria con un error en ingles.
    this.comprobarFechas(
      dto.fecha_ingreso ?? actual.fecha_ingreso,
      dto.fecha_fin === undefined ? actual.fecha_fin : dto.fecha_fin,
    );

    // Bloqueo optimista. Si el cliente manda `version`, la fila tiene que seguir en esa
    // version. `buscar()` la leyo del servidor, asi que `actual.version` es la version
    // que el cliente vio; si el DTO trae otra distinta, el cliente ya va un paso por
    // detras y lo correcto es rechazar en lugar de adivinar.
    //
    // Si no manda `version`, se aplica el cambio igualmente: es el "el ultimo que
    // escribe gana" de antes, y no se rompe a los clientes que no conocen el campo.
    if (dto.version !== undefined && dto.version !== actual.version) {
      throw conflicto(
        `El empleado fue modificado por otra peticion mientras se editaba: la version ${dto.version} ya no es la actual (${actual.version}). Recarga el empleado y vuelve a aplicar el cambio`,
      );
    }

    // Solo se tocan los campos que llegan: un PATCH con `{ activo: false }` no debe
    // vaciar el departamento.
    const cambios: Partial<Empleado> = {
      updated_by: { id: sesion.sub } as Empleado['updated_by'],
    };

    // Un `null` explicito si significa "dejar este campo vacio", que en este recurso es
    // una operacion legitima: un empleado puede quedarse sin departamento o sin puesto.
    if (dto.departamento_id !== undefined)
      cambios.departamento_id = dto.departamento_id;
    if (dto.puesto_id !== undefined) cambios.puesto_id = dto.puesto_id;
    if (dto.codigo !== undefined) {
      // El `codigo` es NULLABLE, y un `null` explicito significa "este empleado ya no
      // tiene codigo". Antes se ignoraba en silencio, que es peor: el cliente creia
      // haberlo quitado y el dato seguia ahi.
      if (dto.codigo !== null) {
        await this.comprobarCodigoLibre(sesion.empresa_id, dto.codigo, id);
      }
      cambios.codigo = dto.codigo;
    }
    if (dto.tipo_contrato !== undefined)
      cambios.tipo_contrato = dto.tipo_contrato;
    if (dto.fecha_ingreso !== undefined)
      cambios.fecha_ingreso = dto.fecha_ingreso;
    if (dto.fecha_fin !== undefined) cambios.fecha_fin = dto.fecha_fin;
    if (dto.activo !== undefined) cambios.activo = dto.activo;

    // Salario e IBAN se re-cifran enteros, no solo cuando cambian de valor. El
    // cifrado lleva un IV aleatorio, asi que volver a cifrar el mismo dato produce otro
    // texto; y por eso el `iban_indice` solo se recalcula cuando el IBAN llega
    // realmente, que es cuando su valor pudo cambiar.
    if (dto.salario !== undefined)
      cambios.salario_cifrado =
        dto.salario === null ? null : this.cifrado.cifrar(String(dto.salario));
    if (dto.iban !== undefined) {
      cambios.iban_cifrado =
        dto.iban === null ? null : this.cifrado.cifrar(dto.iban);
      cambios.iban_indice =
        dto.iban === null
          ? null
          : this.cifrado.indiceCiego(CONTEXTO_IBAN_EMPLEADO, dto.iban);
    }

    // Se modifica la entidad que `buscar()` ya trajo cargada, en lugar de usar
    // `preload()` con un objeto parcial. Dos razones: `preload()` hace su propio SELECT
    // sin relaciones, asi que al proyectar la respuesta `empresa_id` y `persona_id`
    // saldrian `undefined` y el PATCH responderia 500; y `save()` calcula el diff contra
    // la entidad que se le pasa, de modo que aqui solo se escriben las columnas que de
    // verdad cambian, sin tocar las demas.
    Object.assign(actual, cambios);

    // La comprobacion de `version` de arriba solo protege contra el cliente que la
    // manda. `@VersionColumn` cubre el resto: si otra peticion entra entre el SELECT y
    // este `save()`, TypeORM detecta que la fila ya no tiene la version que trae la
    // entidad y lanza esta excepcion. Sin capturarla responderia 500, que dice "fallo
    // del servidor" cuando en realidad es un conflicto del cliente, y el mensaje
    // tipico ("Cannot update entity because entity id is undefined") no le dice nada.
    let guardado: Empleado;
    try {
      guardado = await this.empleados.save(actual);
    } catch (error) {
      if (error instanceof OptimisticLockVersionMismatchError) {
        throw conflicto(
          'El empleado fue modificado por otra peticion mientras se editaba. Recarga el empleado y vuelve a aplicar el cambio',
        );
      }
      throw error;
    }

    const despues = this.aRespuesta(sesion, guardado);

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'empleado',
        entidad_id: id,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  /**
   * Baja logica: marca `deleted_at` y desactiva el empleado.
   *
   * No se borra la fila porque es parte del historico laboral. La columna generada
   * `empresa_persona_vigente` pasa a NULL, asi que la misma persona puede volver a
   * darse de alta mas adelante en esa misma empresa.
   */
  async eliminar(
    sesion: SesionActual,
    id: string,
    contexto?: ContextoPeticion,
  ): Promise<void> {
    const actual = await this.buscar(sesion, id);

    // `repository.softDelete()` no permite escribir `activo` ni `updated_by` en la misma
    // sentencia, que es justo lo que hace falta aqui.
    await this.empleados.update(
      {
        id: actual.id,
        empresa_id: { id: sesion.empresa_id } as Empleado['empresa_id'],
      },
      {
        deleted_at: new Date(),
        activo: false,
        updated_by: { id: sesion.sub } as Empleado['updated_by'],
      },
    );

    await this.auditoria.auditar(
      {
        accion: 'ELIMINAR',
        usuario_id: sesion.sub,
        empresa_id: sesion.empresa_id,
        entidad: 'empleado',
        entidad_id: id,
        datos_antes: this.aRespuesta(sesion, actual) as unknown as Record<
          string,
          unknown
        >,
      },
      contexto,
    );
  }

  /**
   * Busca el empleado dentro de la empresa de la sesion.
   *
   * El filtro por empresa no es opcional: es la barrera que impide leer datos de otra
   * empresa suponiendo un UUID.
   */
  private async buscar(sesion: SesionActual, id: string): Promise<Empleado> {
    const encontrado = await this.empleados.findOne({
      where: {
        id,
        empresa_id: { id: sesion.empresa_id } as Empleado['empresa_id'],
      },
      // Se cargan `empresa_id` y `persona_id` porque `aRespuesta()` lee de las dos
      // relaciones para devolver sus ids; sin `relations` propiedades, TypeORM no
      // rellena esos objetos y la respuesta daria un 500.
      relations: { empresa_id: true, persona_id: true },
    });

    if (!encontrado) throw noEncontrado('el empleado', id);

    return encontrado;
  }

  /**
   * Comprueba que las referencias existen y pertenecen a la empresa de la sesion.
   *
   * `departamento` y `puesto` llevan FKs compuestas `(empresa_id, id)`, de modo que la
   * base ya impide asignar a un empleado el departamento de otra empresa. Aqui se
   * comprueba antes, para responder con un 400 que diga cual de las dos cosas falla en
   * lugar de dejar que MySQL rechace el INSERT con su codigo de error.
   *
   * `persona` es un catalogo global y no lleva empresa, asi que solo se comprueba que
   * exista y no este dada de baja: dar de alta a un empleado de una persona eliminada
   * dejaria una nomina apuntando a un historico que ya no esta.
   */
  private async comprobarReferencias(
    empresaId: string,
    referencias: {
      persona_id: string;
      departamento_id?: string;
      puesto_id?: string;
    },
  ): Promise<void> {
    const persona = await this.personas.findOne({
      where: { id: referencias.persona_id },
    });

    if (!persona) throw noEncontrado('la persona', referencias.persona_id);
    if (!persona.activo) {
      throw new BadRequestException(
        `La persona ${referencias.persona_id} esta dada de baja y no puede tener empleados`,
      );
    }

    if (referencias.departamento_id) {
      const departamento = await this.departamentos.findOne({
        where: {
          id: referencias.departamento_id,
          empresa_id: { id: empresaId } as Departamento['empresa_id'],
        },
      });

      if (!departamento) {
        throw new BadRequestException(
          'El departamento indicado no existe en esta empresa',
        );
      }
    }

    if (referencias.puesto_id) {
      const puesto = await this.puestos.findOne({
        where: {
          id: referencias.puesto_id,
          empresa_id: { id: empresaId } as Puesto['empresa_id'],
        },
      });

      if (!puesto) {
        throw new BadRequestException(
          'El puesto indicado no existe en esta empresa',
        );
      }
    }
  }

  /**
   * Comprueba que el periodo del contrato tenga sentido.
   *
   * Es el CHECK `ck_empleado_fechas` de la base, comprobado aqui para responder con un
   * 400 en castellano. En el alta los dos valores vienen del DTO; en la modificacion
   * son los que quedaran tras el cambio.
   */
  private comprobarFechas(fechaIngreso: string, fechaFin: string | null): void {
    if (fechaFin === null) return;

    if (!fechaAnteriorOIgual(fechaIngreso, fechaFin)) {
      throw new BadRequestException(
        'La fecha de fin no puede ser anterior a la fecha de ingreso',
      );
    }
  }

  /**
   * Comprueba que la persona no este ya de alta en esta empresa.
   *
   * El indice unico `uq_empleado_empresa_persona` usa la columna generada
   * `empresa_persona_vigente`, que vale NULL en las filas borradas: una persona dada de
   * baja puede volver a entrar, y su indice queda libre.
   */
  private async comprobarVinculaLibre(
    empresaId: string,
    personaId: string,
  ): Promise<void> {
    const existente = await this.empleados
      .createQueryBuilder('empleado')
      .where('empleado.empresa_id = :empresaId', { empresaId })
      .andWhere('empleado.persona_id = :personaId', { personaId })
      .andWhere('empleado.deleted_at IS NULL')
      .getOne();

    if (existente) {
      throw conflicto(
        'Esa persona ya esta dada de alta como empleado en esta empresa',
      );
    }
  }

  /**
   * Comprueba que el codigo este libre dentro de la empresa.
   *
   * El UNIQUE `uq_empleado_codigo` va sobre `(empresa_id, codigo_vigente)`, y
   * `codigo_vigente` es NULL en las filas dadas de baja: un codigo retirado con el
   * empleado queda disponible para el siguiente. Por eso el filtro tambien exige
   * `deleted_at IS NULL`, que si no haria que este empleado se chocara consigo mismo al
   * cambiar su propio codigo.
   */
  private async comprobarCodigoLibre(
    empresaId: string,
    codigo: string,
    exceptoId?: string,
  ): Promise<void> {
    const existente = await this.empleados
      .createQueryBuilder('empleado')
      .where('empleado.empresa_id = :empresaId', { empresaId })
      .andWhere('empleado.codigo_vigente = :codigo', { codigo })
      .andWhere('empleado.deleted_at IS NULL')
      .getOne();

    if (existente && existente.id !== exceptoId) {
      throw conflicto(
        `Ya existe un empleado con el codigo ${codigo} en esta empresa`,
      );
    }
  }

  /**
   * Proyecta la entidad a la forma que consume el frontend.
   *
   * Recibe la sesion porque la forma depende de los permisos: sin `empleado.sensible.leer`
   * las columnas sensibles no viajan. Es una proyeccion, no un filtro de seguridad en
   * base de datos, asi que el acceso a la fila ya lo ha authorizing el guard.
   */
  private aRespuesta(
    sesion: SesionActual,
    empleado: Empleado,
  ): EmpleadoRespuesta {
    const sensible = this.veSensibles(sesion);

    return {
      id: empleado.id,
      empresa_id: empleado.empresa_id.id,
      persona_id: empleado.persona_id.id,
      departamento_id: empleado.departamento_id,
      puesto_id: empleado.puesto_id,
      codigo: empleado.codigo,
      tipo_contrato: empleado.tipo_contrato,
      fecha_ingreso: empleado.fecha_ingreso,
      fecha_fin: empleado.fecha_fin,
      ...(sensible
        ? {
            salario: this.aSalario(empleado.salario_cifrado),
            iban:
              empleado.iban_cifrado === null
                ? null
                : this.cifrado.descifrar(empleado.iban_cifrado),
          }
        : {}),
      activo: empleado.activo,
      version: empleado.version,
      created_at: empleado.created_at,
      updated_at: empleado.updated_at,
    };
  }

  /** Si la sesion puede ver salario e IBAN. */
  private veSensibles(sesion: SesionActual): boolean {
    return sesion.permissions.includes(PERMISO_SENSIBLES);
  }

  /**
   * Impide escribir un campo sensible sin permiso para verlo.
   *
   * Se comprueba tambien en la escritura, y no solo en la lectura. Un rol que puede
   * modificar empleados pero no ver sus salarios podria escribir un IBAN equivocado que
   * luego no podria ni corregir ni borrar, porque no lo veria en ninguna respuesta. Ser
   * capaz de tocar algo que no se puede ver es peor que no poder tocarlo.
   *
   * La presencia se mira con `!== undefined` y no enumerando las claves del DTO. La
   * `ValidationPipe` corre con `enableImplicitConversion`, que deja los campos declarados
   * como propiedades aunque no vinieran en el cuerpo: enumerar las claves daria `salario` y
   * `iban` como enviados en un PATCH que solo cambia el tipo de contrato, y el 403 saltaria
   * sin motivo. `null` si cuenta como enviado: anular el salario tambien es tocarlo.
   */
  private comprobarEscrituraSensibles(
    sesion: SesionActual,
    ...campos: { nombre: string; enviado: unknown }[]
  ): void {
    const enviados = campos
      .filter((c) => c.enviado !== undefined)
      .map((c) => c.nombre);

    if (enviados.length > 0 && !this.veSensibles(sesion)) {
      throw new ForbiddenException(
        `Para modificar ${enviados.join(' y ')} hace falta el permiso ${PERMISO_SENSIBLES}`,
      );
    }
  }

  /**
   * Vuelve a numero el salario descifrado.
   *
   * Se cifra como texto porque el cifrado trabaja sobre bytes, y se devuelve como numero
   * para que el cliente no tenga que hacer `parseFloat`: el salario es una cantidad y
   * debe viajar como tal.
   */
  private aSalario(salarioCifrado: string | null): number | null {
    if (salarioCifrado === null) return null;

    const valor = Number(this.cifrado.descifrar(salarioCifrado));

    // Si el texto descifrado no es un numero, la columna esta corrupta o se escribio sin
    // pasar por `CifradoService`. Se avisa en lugar de devolver `null`, porque un `null`
    // aqui significaria "este empleado no tiene salario" y ocultaria un fallo real.
    if (!Number.isFinite(valor)) {
      throw new Error(
        'El salario almacenado no es un numero tras descifrar: la fila esta corrupta',
      );
    }

    return valor;
  }
}
