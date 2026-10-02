import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../database/entities/refresh-token.entity.js';
import { ContextoPeticion } from '../auditoria/auditoria.service.js';
import { TokenHashService } from './token-hash.service.js';

/** Token opaco devuelto al cliente y su registro en base de datos. */
export interface RefreshEmitido {
  token: string;
  registro: RefreshToken;
}

@Injectable()
export class SesionesService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
    private readonly hashService: TokenHashService,
  ) {}

  /**
   * Emite un refresh token nuevo. Si no se indica familia, abre una nueva: es lo
   * que ocurre en el login.
   */
  async emitir(
    usuarioId: string,
    empresaId: string | null,
    familia: string | null,
    contexto?: ContextoPeticion,
  ): Promise<RefreshEmitido> {
    const token = this.hashService.generarToken();
    const id = crypto.randomUUID();
    const expiraEn = this.calcularExpiracion();

    await this.tokens.insert({
      id,
      usuario_id: { id: usuarioId },
      empresa_id: empresaId ? { id: empresaId } : null,
      token_hash: this.hashService.hash(token),
      familia: familia ?? this.hashService.generarFamilia(),
      expira_en: expiraEn,
      revocado_at: null,
      revocado_motivo: null,
      reemplazado_por: null,
      ultimo_uso: null,
      ip: contexto?.ip ?? null,
      user_agent: contexto?.user_agent ?? null,
    });

    const registro = await this.tokens.findOne({ where: { id } });
    return { token, registro: registro! };
  }

  /**
   * Rota un refresh token.
   *
   * Cada token sirve una vez: al presentarlo se revoca y se emite otro de la misma
   * familia. Si llega uno ya revocado, significa que alguien reutilizo un token
   * ya gastado, lo que es indistinguible de un robo. En ese caso se revoca la
   * familia completa y se fuerza un login nuevo.
   */
  async rotar(
    token: string,
    contexto?: ContextoPeticion,
  ): Promise<RefreshEmitido> {
    const hash = this.hashService.hash(token);

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      const actual = await repo.findOne({ where: { token_hash: hash } });

      if (!actual) {
        throw new UnauthorizedException('Refresh token inválido');
      }

      // Reuso: el token ya se habia gastado. Se cae toda la familia.
      //
      // La revocacion se hace FUERA de la transaccion a proposito: si se hiciera
      // dentro y despues se lanzase la excepcion, el rollback dejaria la familia
      // viva y el token robado seguiria valiendo.
      if (actual.revocado_at) {
        await this.revocarFamiliaFuera(actual.familia, 'REUSO_DETECTADO');
        throw new UnauthorizedException(
          'Refresh token reutilizado. Se han cerrado todas las sesiones de esta familia.',
        );
      }

      if (actual.expira_en.getTime() <= Date.now()) {
        throw new UnauthorizedException('Refresh token expirado');
      }

      // Sin `relations`, TypeORM devuelve un objeto plano sin las relaciones
      // cargadas: se piden los UUID sueltos de las columnas.
      const usuarioId = String(
        (await this.leerColumna(repo, actual.id, 'usuario_id')) ??
          actual.usuario_id?.id,
      );
      const empresaId = (await this.leerColumna(
        repo,
        actual.id,
        'empresa_id',
      )) as string | null;

      const emitido = await this.emitirEn(
        repo,
        usuarioId,
        empresaId,
        actual.familia,
        contexto,
      );

      // El UPDATE condicionado a `revocado_at IS NULL` es la barrera real: si dos
      // peticiones llegan con el mismo token a la vez, solo una afecta una fila.
      const resultado = await repo
        .createQueryBuilder()
        .update(RefreshToken)
        .set({
          revocado_at: new Date(),
          revocado_motivo: 'ROTADO',
          ultimo_uso: new Date(),
          reemplazado_por: { id: emitido.registro.id },
        })
        .where('id = :id AND revocado_at IS NULL', { id: actual.id })
        .execute();

      if (resultado.affected !== 1) {
        // Perdimos la carrera: la otra peticion ya lo consumio.
        throw new UnauthorizedException('Refresh token reutilizado');
      }

      actual.revocado_at = new Date();
      actual.revocado_motivo = 'ROTADO';
      actual.reemplazado_por = emitido.registro;
      actual.ultimo_uso = new Date();

      return emitido;
    });
  }

  /** Revoca el token presentado y toda su familia. Es el logout. */
  async revocar(token: string, motivo = 'LOGOUT'): Promise<void> {
    const hash = this.hashService.hash(token);
    const registro = await this.tokens.findOne({ where: { token_hash: hash } });
    if (!registro) return;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      await repo
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revocado_at: new Date(), revocado_motivo: motivo })
        .where('familia = :familia AND revocado_at IS NULL', {
          familia: registro.familia,
        })
        .execute();
    });
  }

  /** Cierra todas las sesiones del usuario. Se usa al desactivar la cuenta. */
  async revocarTodasDelUsuario(
    usuarioId: string,
    motivo: string,
  ): Promise<number> {
    const resultado = await this.tokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revocado_at: new Date(), revocado_motivo: motivo })
      .where('usuario_id = :usuarioId AND revocado_at IS NULL', { usuarioId })
      .execute();

    return resultado.affected ?? 0;
  }

  /**
   * Revoca la familia en su propia transaccion.
   *
   * Se usa en la deteccion de reuso, que necesita que la revocacion sobreviva a la
   * excepcion que se lanza justo despues.
   */
  private async revocarFamiliaFuera(
    familia: string,
    motivo: string,
  ): Promise<void> {
    await this.tokens.manager.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revocado_at: new Date(), revocado_motivo: motivo })
        .where('familia = :familia AND revocado_at IS NULL', { familia })
        .execute();
    });
  }

  /**
   * Lee una columna FK cruda. Necesaria porque las relaciones no se cargan sin
   * `relations`, y aqui interesa el UUID, no la entidad relacionada.
   */
  private async leerColumna(
    repo: Repository<RefreshToken>,
    id: string,
    columna: 'usuario_id' | 'empresa_id',
  ): Promise<string | null> {
    const fila = await repo
      .createQueryBuilder('rt')
      .select(`rt.${columna}`, 'valor')
      .where('rt.id = :id', { id })
      .getRawOne<{ valor: string | null }>();

    return fila?.valor ?? null;
  }

  /** Emision dentro de una transaccion en curso. */
  private async emitirEn(
    repo: Repository<RefreshToken>,
    usuarioId: string,
    empresaId: string | null,
    familia: string,
    contexto?: ContextoPeticion,
  ): Promise<RefreshEmitido> {
    const token = this.hashService.generarToken();
    const id = crypto.randomUUID();

    await repo.insert({
      id,
      usuario_id: { id: usuarioId },
      empresa_id: empresaId ? { id: empresaId } : null,
      token_hash: this.hashService.hash(token),
      familia,
      expira_en: this.calcularExpiracion(),
      revocado_at: null,
      revocado_motivo: null,
      reemplazado_por: null,
      ultimo_uso: null,
      ip: contexto?.ip ?? null,
      user_agent: contexto?.user_agent ?? null,
    });

    const registro = await repo.findOne({ where: { id } });
    return { token, registro: registro! };
  }

  /**
   * Cambia la empresa de la sesion: revoca el refresh actual y emite otro para la nueva.
   *
   * Las dos cosas van en la misma transaccion a proposito. Si se revocara primero y
   * luego fallara la emision (una caida de red, un MySQL que reinicia), el usuario se
   * quedaria sin refresh viejo y sin refresh nuevo: sesion cerrada por un cambio de
   * empresa que ademas devolvio un error, obligando a hacer login otra vez. Con la
   * transaccion, o se cambia o no se cambia nada.
   */
  async cambiarEmpresa(
    tokenActual: string | null,
    usuarioId: string,
    empresaId: string,
    contexto?: ContextoPeticion,
  ): Promise<RefreshEmitido | null> {
    if (!tokenActual) {
      return this.emitir(usuarioId, empresaId, null, contexto);
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(RefreshToken);
      const hash = this.hashService.hash(tokenActual);
      const actual = await repo.findOne({ where: { token_hash: hash } });

      // Se emite primero y se revoca despues. Al revés, un fallo entre medias dejaria el
      // token viejo vivo y el nuevo sin registrar, que es peor: el cambio pareceria
      // haber funcionado y el refresh capturado seguiria sirviendo la empresa anterior.
      const emitido = await this.emitirEn(
        repo,
        usuarioId,
        empresaId,
        this.hashService.generarFamilia(),
        contexto,
      );

      if (actual) {
        await repo.update(
          { id: actual.id },
          {
            revocado_at: new Date(),
            revocado_motivo: 'CAMBIO_EMPRESA',
            reemplazado_por: { id: emitido.registro.id },
          },
        );
      }

      return emitido;
    });
  }

  private calcularExpiracion(): Date {
    const dias = Number(process.env.JWT_REFRESH_EXPIRES_DAYS ?? '7');
    const expira = new Date();
    expira.setDate(expira.getDate() + (Number.isFinite(dias) ? dias : 7));
    return expira;
  }
}
