import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { Role } from '../../../common/role.enum';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  email!: string;

  @Column()
  password!: string;

  @Column({ type: 'enum', enum: Role, default: Role.STAFF })
  role!: Role;

  @Column({ type: 'varchar', nullable: true })
  hashedRefreshToken!: string | null;
}
