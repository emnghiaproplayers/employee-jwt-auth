import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './modules/employee/employee.entity';
import { EmployeeModule } from './modules/employee/employee.module';
import { AuthModule } from './modules/auth/auth.module';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import Keyv from 'keyv';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST') || 'localhost',
        port: parseInt(configService.get<string>('DB_PORT') || '5432', 10),
        username: configService.get<string>('DB_USERNAME') || 'postgres',
        password: configService.get<string>('DB_PASSWORD') || 'mysecretpassword',
        database: configService.get<string>('DB_DATABASE') || 'employee_auth',
        entities: [Employee],
        synchronize: false,
      }),
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const store = await redisStore({
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get<string>('REDIS_PORT') || '6379', 10),
        });
        const keyvStore = {
          get: (key: string) => (store as any).get(key),
          set: (key: string, value: any, ttl?: number) => (store as any).set(key, value, ttl),
          delete: (key: string) => (store as any).del(key).then(() => true),
          clear: () => (store as any).reset(),
        };
        const keyvInstance = new Keyv({
          store: keyvStore,
          namespace: '',
        });
        return {
          stores: [keyvInstance],
        };
      },
    }),
    EmployeeModule,
    AuthModule,
  ],
})
export class AppModule {}
