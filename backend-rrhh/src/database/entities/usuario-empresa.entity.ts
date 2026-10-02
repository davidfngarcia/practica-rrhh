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
import { Rol } from './rol.entity.js';
import { Usuario } from './usuario.entity.js';

/**
 * Membresía de un usuario en una empresa, con su rol asignado.
 *
 * El unique `(empresa_id, usuario_id)` se apoya en `empresa_usuario_vigente`, una
 * columna GENERATED que devuelve NULL si la fila esta eliminada logicamente: asi
 * un usuario puede volver a incorporarse a la misma empresa tras un soft delete.
 */
@Index('idx_usuario_empresa_empresa', ['empresa_id'])
@Index('idx_usuario_empresa_usuario', ['usuario_id'])
@Index('idx_usuario_empresa_rol', ['rol_id'])
@Index('idx_usuario_empresa_empresa_rol', ['empresa_id', 'rol_id'])
@Index('idx_usuario_empresa_created_by', ['created_by'])
@Index('idx_usuario_empresa_updated_by', ['updated_by'])
@Index('uq_usuario_empresa', ['empresa_usuario_vigente'], { unique: true })
@Entity('usuario_empresa')
export class UsuarioEmpresa {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Empresa, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_usuario_empresa_empresa',
  })
  empresa_id: Empresa;

  @ManyToOne(() => Usuario, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'usuario_id',
    foreignKeyConstraintName: 'fk_usuario_empresa_usuario',
  })
  usuario_id: Usuario;

  @ManyToOne(() => Rol, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'rol_id',
    foreignKeyConstraintName: 'fk_usuario_empresa_rol',
  })
  rol_id: Rol;

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
    foreignKeyConstraintName: 'fk_usuario_empresa_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_usuario_empresa_updated_by',
  })
  updated_by: Usuario | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 3 })
  deleted_at: Date | null;

  @Column({
    name: 'empresa_usuario_vigente',
    type: 'varchar',
    length: 80,
    asExpression:
      "IF(`deleted_at` IS NULL, CONCAT(`empresa_id`, '-', `usuario_id`), NULL)",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  empresa_usuario_vigente: string | null;
}
