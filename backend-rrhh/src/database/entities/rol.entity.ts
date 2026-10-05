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
 * Rol de una empresa.
 *
 * `empresa_id` NULL + `es_sistema = 1` marca una **plantilla**: los tres roles que
 * siembra `SeedRolesYPermisos`, que no pertenecen a ninguna empresa y se copian a cada
 * empresa nueva con `crearRolesPlantilla`. Con empresa concreta, el rol pertenece a ese
 * tenant y solo ese lo ve.
 *
 * `es_sistema` ya no significa "global", sino "viene de la plantilla": esos roles se
 * pueden usar y asignar, pero no renombrar ni borrar, porque dejarlos inconsistentes
 * entre empresas es peor que no permitir tocarlos.
 *
 * El unique `(empresa_id, codigo)` se apoya en `empresa_codigo_vigente`, una columna
 * GENERATED que devuelve NULL si la fila esta eliminada logicamente: asi un rol puede
 * volver a crearse tras un soft delete.
 */
@Index('idx_rol_codigo', ['codigo'])
@Index('idx_rol_nombre', ['nombre'])
@Index('idx_rol_empresa', ['empresa_id'])
@Index('idx_rol_empresa_codigo', ['empresa_id', 'codigo'])
@Index('idx_rol_created_by', ['created_by'])
@Index('idx_rol_updated_by', ['updated_by'])
@Index('uq_rol_empresa_codigo', ['empresa_codigo_vigente'], { unique: true })
@Entity('rol')
export class Rol {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Empresa, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_rol_empresa',
  })
  empresa_id: Empresa | null;

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
    name: 'empresa_codigo_vigente',
    type: 'varchar',
    length: 100,
    asExpression:
      "IF(`deleted_at` IS NULL, IF(`empresa_id` IS NULL, `codigo`, CONCAT(`empresa_id`, '-', `codigo`)), NULL)",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  empresa_codigo_vigente: string | null;
}
