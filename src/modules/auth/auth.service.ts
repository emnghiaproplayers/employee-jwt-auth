import { Injectable, ConflictException, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
// import { EmployeeService } from '../employee/employee.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/user.entity';
import { DeviceSession } from './device-session.entity';
import { SignUpDto } from './dto/signup.dto';
import { SignInDto } from './dto/signin.dto';
import * as bcrypt from 'bcrypt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    // private readonly employeeService: EmployeeService,
    // private readonly userService: EmployeeService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(DeviceSession)
    private readonly deviceSessionRepository: Repository<DeviceSession>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) { }

  async signUp(signUpDto: SignUpDto) {
    // const existing = await this.employeeService.findOneByEmail(signUpDto.email);

    // const existing = await this.userService.findOneByEmail(signUpDto.email);
    const existing = await this.userRepository.findOne({ where: { email: signUpDto.email } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(signUpDto.password, 10);
    // const newEmployee = await this.employeeService.create(
    //   signUpDto.email,
    //   passwordHash,
    // );
    // const newUser = await this.userService.create(
    //   signUpDto.email,
    //   passwordHash,
    // );
    const newUser = this.userRepository.create({
      email: signUpDto.email,
      password: passwordHash,
    });
    await this.userRepository.save(newUser);

    const { password: _, ...result } = newUser;
    return result;
  }

  async signIn(signInDto: SignInDto) {
    const { email, password, deviceId } = signInDto;
    // const user = await this.userService.findOneByEmail(signInDto.email);
    const user = await this.userRepository.findOne({ where: { email } });
    // const employee = await this.employeeService.findOneByEmail(signInDto.email);

    // Unify comparison to prevent timing attacks/enumeration
    const dummyHash = '$2b$10$tPjGfN1h/C7KxZ/W8s55Ou.2H8g3HnI5w3P9Jv6hH/Kk8X8Gg7c6q';
    // const hashToCompare = employee ? employee.passwordHash : dummyHash;
    // const hashToCompare = user ? user.passwordHash : dummyHash;
    const hashToCompare = user ? user.password : dummyHash;
    const isMatch = await bcrypt.compare(password, hashToCompare);

    // if (!employee || !isMatch) {
    //   throw new UnauthorizedException('Invalid credentials');
    // }
    if (!user || !isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // const payload = { sub: employee.id, jti: randomUUID() };
    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') || this.configService.get<string>('JWT_SECRET') || 'access_secret',
        expiresIn: '15m',
      },
    );

    const refresh_token = await this.jwtService.signAsync(
      { sub: user.id, deviceId },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh_secret',
        expiresIn: '7d',
      },
    );

    const refreshTokenHash = await bcrypt.hash(refresh_token, 10);

    await this.deviceSessionRepository.upsert(
      {
        userId: user.id,
        deviceId,
        refreshTokenHash,
      },
      ['userId', 'deviceId'],
    );

    return {
      access_token,
      refresh_token,
      deviceId,
    };
  }

  async refreshTokens(userId: number, deviceId: string, refreshToken: string) {
    // Lookup device_sessions by (userId, deviceId)
    const session = await this.deviceSessionRepository.findOne({
      where: { userId, deviceId },
    });

    // If session not found or refreshTokenHash is null -> 401 Unauthorized (Refresh revoked)
    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token has been revoked / logged out');
    }

    // Compare input token with stored hash
    const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);

    // If not matching -> 403 Forbidden (Replay attack / hash mismatch)
    if (!isMatch) {
      throw new ForbiddenException('Refresh token reuse detected / compromised');
    }

    // Find the user to get current email
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate new token pair
    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET') || this.configService.get<string>('JWT_SECRET') || 'access_secret',
        expiresIn: '15m',
      },
    );

    const refresh_token = await this.jwtService.signAsync(
      { sub: user.id, deviceId },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'refresh_secret',
        expiresIn: '7d',
      },
    );

    // Hash the new refresh token
    const newHash = await bcrypt.hash(refresh_token, 10);

    // Update session table (Rotation)
    await this.deviceSessionRepository.update(
      { id: session.id },
      { refreshTokenHash: newHash }
    );

    return {
      access_token,
      refresh_token,
      deviceId,
    };
  }

  async logout(userId: number, deviceId: string, token?: string): Promise<void> {
    await this.deviceSessionRepository.update(
      { userId, deviceId },
      { refreshTokenHash: null }
    );

    if (token) {
      try {
        const decoded = this.jwtService.decode(token) as any;
        if (decoded && decoded.jti && decoded.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            await this.cacheManager.set(`blacklist:${decoded.jti}`, '1', ttl * 1000);
          }
        }
      } catch (e) {
        // Ignore
      }
    }
  }
}
