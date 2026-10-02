import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  VersionColumn,
} from 'typeorm';
import { Empresa } from './empresa.entity.js';
import { Persona } from './persona.entity.js';
import { Usuario } from './usuario.entity.js';

/**
 * Empleado: vincula una persona con una empresa. En esa empresa la persona puede
 * tener departamento y puesto. El aislamiento entre empresas se mantiene en la
 * base de datos mediante las FKs compuestas (empresa_id, departamento_id) y
 * (empresa_id, puesto_id). Debido a que `empresa_id` participa en tres FKs,
 * TypeORM no puede mapear esas relaciones compuestas sin duplicar columnas: por
 * ello se exponen `departamento_id` y `puesto_id` como columnas simples. Este es
 * el trade-off aceptado para conservar las garantias a nivel de BD.
 */
@Index('idx_empleado_empresa', ['empresa_id'])
@Index('idx_empleado_persona', ['persona_id'])
@Index('idx_empleado_departamento', ['departamento_id'])
@Index('idx_empleado_puesto', ['puesto_id'])
@Index('idx_empleado_fecha_ingreso', ['fecha_ingreso'])
@Index('idx_empleado_created_by', ['created_by'])
@Index('idx_empleado_updated_by', ['updated_by'])
@Index('idx_empleado_iban', ['empresa_id', 'iban_indice'])
@Index('uq_empleado_empresa_persona', ['empresa_persona_vigente'], {
  unique: true,
})
@Index('uq_empleado_codigo', ['empresa_id', 'codigo_vigente'], { unique: true })
@Entity('empleado')
export class Empleado {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @ManyToOne(() => Empresa, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'empresa_id',
    foreignKeyConstraintName: 'fk_empleado_empresa',
  })
  empresa_id: Empresa;

  @ManyToOne(() => Persona, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'persona_id',
    foreignKeyConstraintName: 'fk_empleado_persona',
  })
  persona_id: Persona;

  @Column({ name: 'departamento_id', type: 'char', length: 36, nullable: true })
  departamento_id: string | null;

  @Column({ name: 'puesto_id', type: 'char', length: 36, nullable: true })
  puesto_id: string | null;

  /**
   * Codigo del empleado dentro de su empresa. Es NULLABLE a proposito: el enunciado no
   * obliga a que toda empresa numere a su plantilla, y exigirlo impediria dar de alta
   * a alguien en una empresa que todavia no tiene numeracion.
   *
   * El UNIQUE va sobre `codigo_vigente` dentro de `empresa_id`, no sobre el codigo a
   * secas: es un codigo por empresa, no global, y queda libre tras la baja logica.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  codigo: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PLANTA' })
  tipo_contrato: string;

  @Column({ type: 'date' })
  fecha_ingreso: string;

  @Column({ type: 'date', nullable: true })
  fecha_fin: string | null;

  /**
   * Salario e IBAN van cifrados en reposo. Son de los pocos datos que justifican que
   * una copia de la base sea un problema: el salario dice cuanto gana cada persona y el
   * IBAN da acceso a su cuenta.
   *
   * Se guardan dos columnas y no una porque el cifrado usa un IV aleatorio y no se
   * puede consultar sobre el texto cifrado. El indice ciego, en cambio, es
   * determinista: sobre el se busca y se comprueban duplicados. `CifradoService` es la
   * unica que escribe estas columnas.
   */
  @Column({ name: 'salario_cifrado', type: 'text', nullable: true })
  salario_cifrado: string | null;

  @Column({ name: 'iban_cifrado', type: 'text', nullable: true })
  iban_cifrado: string | null;

  @Column({ name: 'iban_indice', type: 'char', length: 64, nullable: true })
  iban_indice: string | null;

  /**
   * Bloqueo optimista.
   *
   * Dos personas pueden editar el mismo empleado a la vez (RRHH corrige un salary
   * mientras el jefe asigna un puesto). Sin esto, la segunda escritura se lleva por
   * delante la primera sin avisar. Con `version`, TypeORM pone `WHERE version = <la
   * que se leyo>`: si otra escritura se adelanto, actualiza cero filas y el servicio
   * responde 409 en vez de perder el cambio.
   */
  @VersionColumn({ default: 0 })
  version: number;

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
    foreignKeyConstraintName: 'fk_empleado_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_empleado_updated_by',
  })
  updated_by: Usuario | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 3 })
  deleted_at: Date | null;

  /**
   * `codigo` mientras la fila esta viva, `NULL` cuando esta dada de baja. Mismo criterio
   * que en `departamento`, `puesto` y `usuario_vigente`: el UNIQUE va aqui para que un
   * codigo retirado con el empleado se pueda volver a asignar a otro.
   */
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

  @Column({
    name: 'empresa_persona_vigente',
    type: 'varchar',
    length: 80,
    asExpression:
      "IF(`deleted_at` IS NULL, CONCAT(`empresa_id`, '-', `persona_id`), NULL)",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  empresa_persona_vigente: string | null;
}
