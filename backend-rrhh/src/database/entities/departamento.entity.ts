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
import { Empresa } from './empresa.entity.js';
import { Usuario } from './usuario.entity.js';

/**
 * Departamento: scoped a empresa. Requiere aislamiento entre empresas.
 */
@Index('idx_departamento_codigo', ['codigo'])
@Index('idx_departamento_empresa_nombre', ['empresa_id', 'nombre'])
@Index('idx_departamento_created_by', ['created_by'])
@Index('idx_departamento_updated_by', ['updated_by'])
@Index('uq_departamento_codigo', ['empresa_id', 'codigo_vigente'], {
  unique: true,
})
@Index('uq_departamento_empresa_id', ['empresa_id', 'id'], { unique: true })
@Entity('departamento')
export class Departamento {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Empresa, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_departamento_empresa',
  })
  empresa_id: Empresa;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

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
    foreignKeyConstraintName: 'fk_departamento_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_departamento_updated_by',
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
