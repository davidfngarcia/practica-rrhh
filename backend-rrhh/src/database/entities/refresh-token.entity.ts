import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Empresa } from './empresa.entity.js';
import { Usuario } from './usuario.entity.js';

/**
 * Token de refresco.
 */
@Index('idx_refresh_token_usuario_expira', ['usuario_id', 'expira_en'])
@Index('idx_refresh_token_expira', ['expira_en'])
@Index('idx_refresh_token_familia', ['familia'])
@Index('idx_refresh_token_reemplazado_por', ['reemplazado_por'])
@Index('idx_refresh_token_empresa', ['empresa_id'])
@Index('uq_refresh_token_hash', ['token_hash'], { unique: true })
@Entity('refresh_token')
export class RefreshToken {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Usuario, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'usuario_id',
    foreignKeyConstraintName: 'fk_refresh_token_usuario',
  })
  usuario_id: Usuario;

  @ManyToOne(() => Empresa, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_refresh_token_empresa',
  })
  empresa_id: Empresa | null;

  @Column({ type: 'char', length: 64 })
  token_hash: string;

  @Column({ type: 'char', length: 36 })
  familia: string;

  @Column({ type: 'datetime', precision: 3 })
  expira_en: Date;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  revocado_at: Date | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  revocado_motivo: string | null;

  /**
   * Auto-referencia al token que sustituyo a este durante la rotacion.
   * `ON DELETE SET NULL`: si se purga el token sustituto, el registro previo
   * conserva su historial sin romper la integridad.
   */
  @ManyToOne(() => RefreshToken, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'reemplazado_por',
    foreignKeyConstraintName: 'fk_refresh_token_reemplazado_por',
  })
  reemplazado_por: RefreshToken | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  ultimo_uso: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_agent: string | null;

  @CreateDateColumn({
    name: 'creado_en',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  creado_en: Date;
}
