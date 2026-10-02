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
 * Auditoria de acciones de negocio: solo-append. No tiene `updated_at`,
 * `updated_by` ni `deleted_at`; un log que se puede editar deja de ser un log.
 *
 * `empresa_id` y `usuario_id` admiten NULL porque hay acciones sin empresa (alta de
 * plataforma) o sin usuario autenticado (intento de login fallido).
 */
@Index('idx_auditoria_fecha', ['creado_en'])
@Index('idx_auditoria_entidad', ['entidad', 'entidad_id'])
@Index('idx_auditoria_empresa_fecha', ['empresa_id', 'creado_en'])
@Index('idx_auditoria_usuario_fecha', ['usuario_id', 'creado_en'])
@Entity('auditoria')
export class Auditoria {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Empresa, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_auditoria_empresa',
  })
  empresa_id: Empresa | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'usuario_id',
    foreignKeyConstraintName: 'fk_auditoria_usuario',
  })
  usuario_id: Usuario | null;

  @Column({ type: 'varchar', length: 50 })
  accion: string;

  @Column({ type: 'varchar', length: 50 })
  entidad: string;

  @Column({ type: 'char', length: 36, nullable: true })
  entidad_id: string | null;

  @Column({ type: 'json', nullable: true })
  datos_antes: Record<string, unknown> | null;

  @Column({ type: 'json', nullable: true })
  datos_despues: Record<string, unknown> | null;

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
