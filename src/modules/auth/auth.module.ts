import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
// import { EmployeeModule } from '../employee/employee.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RefreshTokenStrategy } from './refresh-token.strategy';
import { User } from '../user/user.entity';
import { DeviceSession } from './device-session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    // EmployeeModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRATION') ||
            '15m') as any,
        },
      }),
    }),
    TypeOrmModule.forFeature([User, DeviceSession]),
  ],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RefreshTokenStrategy],
  controllers: [AuthController],
  exports: [JwtAuthGuard, JwtModule, PassportModule],
})
export class AuthModule {}
