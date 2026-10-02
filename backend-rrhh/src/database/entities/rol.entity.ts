import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity.js';

/**
 * Rol (catálogo global). `es_sistema` protege los roles sembrados.
 */
@Index('idx_rol_codigo', ['codigo'])
@Index('idx_rol_nombre', ['nombre'])
@Index('idx_rol_created_by', ['created_by'])
@Index('idx_rol_updated_by', ['updated_by'])
@Index('uq_rol_codigo', ['codigo_vigente'], { unique: true })
@Entity('rol')
export class Rol {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean', default: false })
  es_sistema: boolean;

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
    foreignKeyConstraintName: 'fk_rol_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_rol_updated_by',
  })
  updated_by: Usuario | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 3 })
  deleted_at: Date | null;

  @Column({
    name: 'codigo_vigente',
    type: 'varchar',
    length: 50,
    asExpression: 'IF(`deleted_at` IS NULL, `codigo`, NULL)',
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  codigo_vigente: string | null;
}
