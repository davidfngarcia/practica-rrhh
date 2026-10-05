import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { noEncontrado } from '../common/errores.js';
import { Empresa } from '../database/entities/empresa.entity.js';
import type { ActualizarEmpresaDto } from './empresa.dto.js';

/** Forma que devuelve la API. */
export interface EmpresaRespuesta {
  id: string;
  codigo: string;
  nombre: string;
  razon_social: string | null;
  nombre_comercial: string | null;
  identificacion_tributaria: string | null;
  email: string | null;
  telefono: string | null;
  direccion: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Empresa de la sesion.
 *
 * A diferencia del resto de areas, aqui **no hay ni listado ni alta ni baja**, y no es
 * que falten por falta de tiempo: es que serian un agujero en el aislamiento.
 *
 * La empresa es la raiz del multi-tenant. Cualquier peticion lleva ya una empresa en el
 * token, y todas las demas consultas se filtran por ella. Si existiera `GET /empresas`
 * devolveria la lista de tenants del cliente, y si existiera `POST /empresas` cualquier
 * usuario autenticado podria crear una empresa y, al autenticarse en ella, ser su propio
 * administrador: un ADMIN_EMPRESA recien creado controlando una empresa recien creada.
 *
 * El alta de una empresa es una operacion de la plataforma, no del tenant: se hace
 * migrando datos o por una consola de administracion con otro mecanismo de
 * autenticacion. `GET /auth/empresas` si lista las empresas a las que este usuario
 * pertenece, que es lo que necesita el selector del frontend.
 *
 * Lo que si tiene sentido es consultar y corregir los datos de la empresa propia, y por
 * eso estas rutas no aceptan ningun identificador: salen del token.
 */
@Injectable()
export class EmpresasService {
  constructor(
    @InjectRepository(Empresa)
    private readonly empresas: Repository<Empresa>,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * La empresa de la sesion.
   *
   * Se busca por el `empresa_id` del token y no por un `id` de la ruta, asi que no hay
   * forma de pedir los datos de otra empresa: la ruta ni siquiera lleva un sitio donde
   * ponerlo.
   */
  async obtener(empresaId: string): Promise<EmpresaRespuesta> {
    return this.aRespuesta(await this.buscar(empresaId));
  }

  /**
   * Actualiza los datos de la empresa propia.
   *
   * `activo` y `codigo` no se tocan. Desactivar la propia empresa dejaria al usuario sin
   * nada a lo que entrar y sin una ruta para revertirlo, porque esta misma API quedaria
   * inutilizable para el.
   */
  async actualizar(
    empresaId: string,
    usuarioId: string,
    dto: ActualizarEmpresaDto,
    contexto?: ContextoPeticion,
  ): Promise<EmpresaRespuesta> {
    const actual = await this.buscar(empresaId);
    const antes = this.aRespuesta(actual);

    // Solo se tocan los campos que llegan: un PATCH con `{ telefono }` no debe borrar
    // la direccion.
    const cambios: Partial<Empresa> = {
      updated_by: { id: usuarioId } as Empresa['updated_by'],
    };

    if (dto.nombre_comercial !== undefined)
      cambios.nombre_comercial = dto.nombre_comercial;
    if (dto.razon_social !== undefined) cambios.razon_social = dto.razon_social;
    if (dto.email !== undefined) cambios.email = dto.email;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    if (dto.direccion !== undefined) cambios.direccion = dto.direccion;

    // `save()` con un objeto parcial devuelve solo lo enviado. `preload()` parte de la
    // fila completa y aplica encima los cambios, de modo que la respuesta trae todos
    // los campos y la auditoria guarda un estado posterior completo.
    const preparado = await this.empresas.preload({
      ...cambios,
      id: actual.id,
    });

    // `preload()` solo devuelve `undefined` si la fila ya no existe, y `buscar` la acaba
    // de encontrar.
    if (!preparado) throw noEncontrado('la empresa', empresaId);

    const guardado = await this.empresas.save(preparado);
    const despues = this.aRespuesta(guardado);

    await this.auditoria.auditar(
      {
        accion: 'ACTUALIZAR',
        usuario_id: usuarioId,
        empresa_id: empresaId,
        entidad: 'empresa',
        entidad_id: empresaId,
        datos_antes: antes as unknown as Record<string, unknown>,
        datos_despues: despues as unknown as Record<string, unknown>,
      },
      contexto,
    );

    return despues;
  }

  private async buscar(empresaId: string): Promise<Empresa> {
    const encontrada = await this.empresas.findOne({
      where: { id: empresaId },
    });

    if (!encontrada) throw noEncontrado('la empresa', empresaId);

    return encontrada;
  }

  /** Proyecta la entidad a la forma que consume el frontend. */
  private aRespuesta(empresa: Empresa): EmpresaRespuesta {
    return {
      id: empresa.id,
      codigo: empresa.codigo,
      nombre: empresa.nombre,
      razon_social: empresa.razon_social,
      nombre_comercial: empresa.nombre_comercial,
      identificacion_tributaria: empresa.identificacion_tributaria,
      email: empresa.email,
      telefono: empresa.telefono,
      direccion: empresa.direccion,
      activo: empresa.activo,
      created_at: empresa.created_at,
      updated_at: empresa.updated_at,
    };
  }
}
