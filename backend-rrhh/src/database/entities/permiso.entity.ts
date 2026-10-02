import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity.js';

/**
 * Permiso (catálogo global).
 */
@Index('idx_permiso_codigo', ['codigo'])
@Index('idx_permiso_modulo', ['modulo'])
@Index('idx_permiso_created_by', ['created_by'])
@Index('idx_permiso_updated_by', ['updated_by'])
@Index('uq_permiso_codigo', ['codigo_vigente'], { unique: true })
@Entity('permiso')
export class Permiso {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  codigo: string;

  @Column({ type: 'varchar', length: 50 })
  modulo: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  created_at: Date;

  @Column({
    name: 'updated_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  })
  updated_at: Date;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_permiso_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_permiso_updated_by',
  })
  updated_by: Usuario | null;

  @Column({
    name: 'deleted_at',
    type: 'datetime',
    precision: 3,
    nullable: true,
  })
  deleted_at: Date | null;

  @Column({
    name: 'codigo_vigente',
    type: 'varchar',
    length: 100,
    asExpression: 'IF(`deleted_at` IS NULL, `codigo`, NULL)',
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  codigo_vigente: string | null;
}
