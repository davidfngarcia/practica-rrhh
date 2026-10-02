import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

/**
 * Identidad global de acceso al sistema. No lleva `empresa_id`: un usuario existe con
 * independencia de las empresas a las que pertenezca. La pertenencia se modela en
 * `UsuarioEmpresa`.
 *
 * La jerarquia es `parent_user_id`: un usuario cuelga de quien lo creo, y por debajo
 * de un usuario solo puede crear quien tenga permisos iguales o menores. Esa segunda
 * parte no la garantiza la FK, la garantiza `UsuariosService` antes de insertar.
 */
@Index('uq_usuarios_usuario', ['usuario_vigente'], { unique: true })
@Index('uq_usuarios_email', ['email_vigente'], { unique: true })
@Index('idx_usuarios_usuario', ['usuario'])
@Index('idx_usuarios_parent_user', ['parent_user_id'])
@Entity('usuarios')
export class Usuario {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 128 })
  usuario: string;

  @Column({ type: 'varchar', length: 128 })
  password_hash: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string | null;

  /**
   * Usuario que creo a este. `ON DELETE RESTRICT`: no se puede borrar a un usuario que
   * tiene hijos colgando, porque dejaria a esos huerfanos sin quien los creara.
   */
  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({
    name: 'parent_user_id',
    foreignKeyConstraintName: 'fk_usuarios_parent_user',
  })
  parent_user_id: Usuario | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  ultimo_acceso: Date | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  deleted_at: Date | null;

  @Column({
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

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'fk_usuarios_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, { nullable: true })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_usuarios_updated_by',
  })
  updated_by: Usuario | null;

  /**
   * `usuario` mientras la fila esta viva, `NULL` cuando esta dada de baja. Sobre esta
   * columna va el UNIQUE, igual que `codigo_vigente` en los catalogos: asi un nombre de
   * acceso queda disponible para reutilizar tras el borrado logico, y `usuario` deja de
   * estar unico de por si sola.
   *
   * `insert`/`update`/`select` en false porque MySQL no deja escribir en una columna
   * generada: es de lectura, como `codigo_vigente`.
   */
  @Column({
    name: 'usuario_vigente',
    type: 'varchar',
    length: 128,
    insert: false,
    update: false,
    select: false,
    asExpression: 'IF(`deleted_at` IS NULL, `usuario`, NULL)',
    generatedType: 'STORED',
  })
  usuario_vigente: string | null;

  /** Igual que `usuario_vigente`, pero para el correo. */
  @Column({
    name: 'email_vigente',
    type: 'varchar',
    length: 150,
    insert: false,
    update: false,
    select: false,
    asExpression: 'IF(`deleted_at` IS NULL, `email`, NULL)',
    generatedType: 'STORED',
  })
  email_vigente: string | null;
}
