import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Employee } from '../modules/employee/employee.entity';

dotenv.config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'mysecretpassword',
  database: process.env.DB_DATABASE || 'employee_auth',
  entities: [Employee],
  synchronize: false,
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
});
