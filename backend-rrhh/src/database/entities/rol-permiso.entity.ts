import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Permiso } from './permiso.entity.js';
import { Rol } from './rol.entity.js';
import { Usuario } from './usuario.entity.js';

/**
 * Rol - Permiso (puente).
 */
@Index('idx_rol_permiso_permiso', ['permiso_id'])
@Index('idx_rol_permiso_created_by', ['created_by'])
@Entity('rol_permiso')
export class RolPermiso {
  @PrimaryColumn({ type: 'char', length: 36, name: 'rol_id' })
  rol_id: string;

  @ManyToOne(() => Rol, {
    nullable: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'rol_id',
    foreignKeyConstraintName: 'fk_rol_permiso_rol',
  })
  rol: Rol;

  @PrimaryColumn({ type: 'char', length: 36, name: 'permiso_id' })
  permiso_id: string;

  @ManyToOne(() => Permiso, {
    nullable: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'permiso_id',
    foreignKeyConstraintName: 'fk_rol_permiso_permiso',
  })
  permiso: Permiso;

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
    foreignKeyConstraintName: 'fk_rol_permiso_created_by',
  })
  created_by: Usuario | null;
}
