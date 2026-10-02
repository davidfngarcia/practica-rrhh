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
 * Empresa cliente. Es la raiz del aislamiento multi-tenant: las tablas que llevan
 * `empresa_id` se filtran siempre por ella.
 *
 * `codigo_vigente` es una columna GENERATED: devuelve `codigo` mientras la fila no
 * este eliminada logicamente y `NULL` en caso contrario. MySQL admite varios NULL
 * en un indice UNIQUE, asi que un `codigo` solo queda reservado entre filas vivas.
 */
@Index('idx_empresa_codigo', ['codigo'])
@Index('idx_empresa_nombre', ['nombre'])
@Index('idx_empresa_created_by', ['created_by'])
@Index('idx_empresa_updated_by', ['updated_by'])
@Index('uq_empresa_codigo', ['codigo_vigente'], { unique: true })
@Entity('empresa')
export class Empresa {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 50 })
  codigo: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  razon_social: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  nombre_comercial: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  identificacion_tributaria: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  created_at: Date;

  /**
   * No se usa `@UpdateDateColumn`: TypeORM fuerza `ON UPDATE CURRENT_TIMESTAMP(6)`
   * sin importar el `precision`, y el esquema usa `(3)`. Con un `@Column` normal
   * la expresion queda exactamente como la definio la migracion.
   */
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
    foreignKeyConstraintName: 'fk_empresa_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_empresa_updated_by',
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
