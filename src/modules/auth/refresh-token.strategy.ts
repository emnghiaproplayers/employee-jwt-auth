import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
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

    // Check if token is blacklisted
    if (decoded.jti) {
      const isBlacklisted = await this.cacheManager.get(`blacklist:${decoded.jti}`);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token revoked');
      }
    }

    // Verify the refresh token against the stored hash
    const session = await this.deviceSessionRepository.findOne({
      where: { userId: decoded.sub, deviceId: decoded.deviceId },
    });

    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedException('No active session found');
    }

    const isMatch = await bcrypt.compare(refreshToken, session.refreshTokenHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return { userId: decoded.sub, deviceId: decoded.deviceId };
  }
}
