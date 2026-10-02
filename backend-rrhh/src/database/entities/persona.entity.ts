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
 * Persona (catalogo global de personas naturales).
 *
 * `numero_documento` se guarda cifrado. El documento de identidad es el dato mas
 * sensible de los tres que pide proteger el enunciado (junto a salario e IBAN): identifica
 * a una persona civil y no aporta nada a la gestion de la nomina.
 *
 * De ahi las dos columnas. `numero_documento` es el texto cifrado, ilegible sin
 * `DATA_ENCRYPTION_KEY`, y no se puede consultar directamente porque el cifrado lleva un
 * IV aleatorio. `documento_indice` es un HMAC determinista del documento: sobre el si se
 * busca por igualdad y sobre el va el UNIQUE.
 *
 * Lo que se pierde: la busqueda por fragmento ("todos los documentos que contengan
 * 1234"). No hay forma de tener las dos cosas, si el documento no esta en claro. Se
 * asume la busqueda exacta.
 */
@Index('idx_persona_documento_indice', ['documento_indice'])
@Index('idx_persona_nombres', ['nombres'])
@Index('idx_persona_apellidos', ['apellidos'])
@Index('idx_persona_created_by', ['created_by'])
@Index('idx_persona_updated_by', ['updated_by'])
@Index('uq_persona_documento', ['documento_indice_vigente'], { unique: true })
@Entity('persona')
export class Persona {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string;

  /**
   * Obligatorio en la base. El valor NULL no tiene sentido: sin tipo de documento no
   * se puede validar el CHECK `ck_persona_tipo_documento`.
   */
  @Column({ type: 'varchar', length: 20 })
  tipo_documento: string;

  /**
   * Texto cifrado del numero de documento, no el numero. Solo `CifradoService` y
   * `PersonasService` deben escribirlo: escribir aqui un numero en claro seria el
   * descuido que esta columna existe para evitar.
   */
  @Column({ type: 'varchar', length: 255 })
  numero_documento: string;

  /**
   * HMAC-SHA256 de `tipo_documento` y `numero_documento`. Es determinista (el mismo
   * documento da siempre el mismo indice, que es lo que permite el UNIQUE y el filtro),
   * e irreversible sin la clave.
   */
  @Column({ type: 'char', length: 64, nullable: true })
  documento_indice: string | null;

  @Column({ type: 'varchar', length: 100 })
  nombres: string;

  @Column({ type: 'varchar', length: 100 })
  apellidos: string;

  @Column({ type: 'date', nullable: true })
  fecha_nacimiento: string | null;

  @Column({ type: 'char', length: 1, nullable: true })
  genero: string | null;

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
    foreignKeyConstraintName: 'fk_persona_created_by',
  })
  created_by: Usuario | null;

  @ManyToOne(() => Usuario, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({
    name: 'updated_by',
    foreignKeyConstraintName: 'fk_persona_updated_by',
  })
  updated_by: Usuario | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', precision: 3 })
  deleted_at: Date | null;

  /**
   * `documento_indice` mientras la persona esta viva, `NULL` cuando se elimina
   * logicamente. El UNIQUE va aqui, y no sobre `documento_indice` a secas, para que el
   * documento de una persona dada de baja se pueda volver a usar en otra Alta. Con el
   * documento cifrado, el indice es lo unico que identifica a la persona a efectos de
   * unicidad, asi que la liberacion depende de que el UNIQUE mire esta columna.
   */
  @Column({
    name: 'documento_indice_vigente',
    type: 'char',
    length: 64,
    asExpression: 'IF(`deleted_at` IS NULL, `documento_indice`, NULL)',
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
    nullable: true,
  })
  documento_indice_vigente: string | null;
}
