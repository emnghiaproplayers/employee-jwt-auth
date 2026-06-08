import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
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
  ) {}

  async signUp(signUpDto: SignUpDto) {
    // const existing = await this.employeeService.findOneByEmail(signUpDto.email);

    // const existing = await this.userService.findOneByEmail(signUpDto.email);
    const existing = await this.userRepository.findOne({
      where: { email: signUpDto.email },
    });
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
      role: signUpDto.role,
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
    const dummyHash =
      '$2b$10$tPjGfN1h/C7KxZ/W8s55Ou.2H8g3HnI5w3P9Jv6hH/Kk8X8Gg7c6q';
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

    // Phát Access Token với unique JWT ID (jti)
    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'access_secret',
        expiresIn: '15m',
        jwtid: randomUUID(),
      },
    );

    // Phát Refresh Token với unique JWT ID (jti)
    const refresh_token = await this.jwtService.signAsync(
      { sub: user.id, deviceId },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'refresh_secret',
        expiresIn: '7d',
        jwtid: randomUUID(),
      },
    );

    const refreshTokenHash = await bcrypt.hash(refresh_token, 10);

    // Lưu / cập nhật phiên đăng nhập của thiết bị vào DB
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
    // 1. Giải mã token để lấy thông tin jti phục vụ đối chiếu blacklist
    let decoded: any;
    try {
      decoded = this.jwtService.decode(refreshToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 2. Kiểm tra xem Refresh Token có nằm trong Cache Blacklist (Redis) hay không
    if (decoded && decoded.jti) {
      const isBlacklisted = await this.cacheManager.get(
        `blacklist:${decoded.jti}`,
      );
      if (isBlacklisted) {
        throw new ForbiddenException(
          'Refresh token reuse detected / blacklisted',
        );
      }
    }

    // 3. Tìm kiếm thông tin phiên làm việc trong DB theo (userId, deviceId)
    const session = await this.deviceSessionRepository.findOne({
      where: { userId, deviceId },
    });

    // Nếu không tìm thấy hoặc cột refreshTokenHash = null -> 401 Unauthorized (Phiên đã thu hồi/Logout)
    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedException(
        'Refresh token has been revoked / logged out',
      );
    }

    // 4. So khớp Refresh Token với Hash lưu trong DB
    const isMatch = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash,
    );

    // Nếu không khớp -> 403 Forbidden (Nghi ngờ Reuse/Replay attack)
    if (!isMatch) {
      // Khi phát hiện hành vi tái sử dụng token cũ, lập tức thu hồi phiên (set null) để bảo vệ hệ thống
      await this.deviceSessionRepository.update(
        { id: session.id },
        { refreshTokenHash: null },
      );
      throw new ForbiddenException(
        'Refresh token reuse detected / compromised',
      );
    }

    // 5. Tìm user hiện tại để trích xuất email
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // 6. Phát cặp token mới
    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret:
          this.configService.get<string>('JWT_ACCESS_SECRET') ||
          this.configService.get<string>('JWT_SECRET') ||
          'access_secret',
        expiresIn: '15m',
        jwtid: randomUUID(),
      },
    );

    const refresh_token = await this.jwtService.signAsync(
      { sub: user.id, deviceId },
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ||
          'refresh_secret',
        expiresIn: '7d',
        jwtid: randomUUID(),
      },
    );

    // 7. Mã hóa Refresh Token mới
    const newHash = await bcrypt.hash(refresh_token, 10);

    // 8. Cập nhật hash mới vào DB (Rotation)
    await this.deviceSessionRepository.update(
      { id: session.id },
      { refreshTokenHash: newHash },
    );

    // 9. Blacklist JTI của Refresh Token cũ để không thể tái sử dụng
    if (decoded && decoded.jti && decoded.exp) {
      const ttl = decoded.exp - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await this.cacheManager.set(
          `blacklist:${decoded.jti}`,
          '1',
          ttl * 1000,
        );
      }
    }

    return {
      access_token,
      refresh_token,
      deviceId,
    };
  }

  async logout(
    userId: number,
    deviceId: string,
    accessToken?: string,
  ): Promise<void> {
    // 1. Kiểm tra database xem phiên (session) đã được thu hồi trước đó chưa
    const session = await this.deviceSessionRepository.findOne({
      where: { userId, deviceId },
    });

    if (!session || session.refreshTokenHash === null) {
      // Phiên đã được thu hồi hoặc không tồn tại (tránh việc gọi ghi đè lại nếu đã đăng xuất)
      return;
    }

    // 2. Thu hồi token bằng cách cập nhật refreshTokenHash thành null
    await this.deviceSessionRepository.update(
      { id: session.id },
      { refreshTokenHash: null },
    );

    // 3. Đưa Access Token JTI vào Blacklist Cache (Redis) để chặn sử dụng ngay lập tức
    if (accessToken) {
      try {
        const decoded = this.jwtService.decode(accessToken);
        if (decoded && decoded.jti && decoded.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            // Lưu vào Redis blacklist với TTL động
            await this.cacheManager.set(
              `blacklist:${decoded.jti}`,
              '1',
              ttl * 1000,
            );
          }
        }
      } catch (e) {
        // Bỏ qua lỗi nếu giải mã hoặc ghi cache thất bại
      }
    }
  }
}
