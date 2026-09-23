import {
  Entity,
  Column,
  PrimaryColumn,
} from 'typeorm';

@Entity('usuarios') // Nombre exacto de tu tabla en MySQL
export class Usuario {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  usuario: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 128 })
  passwordHash: string;
}