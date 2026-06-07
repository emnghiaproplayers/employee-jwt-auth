import { Injectable, UnauthorizedException, ForbiddenException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { DeviceSession } from './device-session.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly jwtService: JwtService,
    @InjectRepository(DeviceSession)
    private readonly deviceSessionRepository: Repository<DeviceSession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    const authHeader = req.headers.authorization;
    const refreshToken = authHeader?.split(' ')[1];

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const decoded = this.jwtService.decode(refreshToken) as any;
    if (!decoded) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // 1. Kiểm tra xem Refresh Token có nằm trong Cache Blacklist (Redis) hay không
    if (decoded.jti) {
      const isBlacklisted = await this.cacheManager.get(`blacklist:${decoded.jti}`);
      if (isBlacklisted) {
        throw new ForbiddenException('Refresh token has been blacklisted');
      }
    }

    // 2. Tìm kiếm thông tin phiên làm việc trong DB theo (userId, deviceId)
    const session = await this.deviceSessionRepository.findOne({
      where: { userId: decoded.sub, deviceId: decoded.deviceId },
    });

    // Nếu không tìm thấy hoặc cột refreshTokenHash = null -> 401 Unauthorized (Phiên đã thu hồi/Logout)
    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedException('No active session found / refresh token revoked');
    }

    // 3. So khớp Refresh Token với Hash lưu trong DB
    const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    
    // Nếu không khớp -> 403 Forbidden (Nghi ngờ Reuse/Replay attack)
    if (!isMatch) {
      // Khi phát hiện hành vi tái sử dụng token cũ, lập tức thu hồi phiên (set null) để bảo vệ hệ thống
      await this.deviceSessionRepository.update(
        { id: session.id },
        { refreshTokenHash: null }
      );
      throw new ForbiddenException('Refresh token reuse detected / compromised');
    }

    return { userId: decoded.sub, deviceId: decoded.deviceId, refreshToken };
  }
}
