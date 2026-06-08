import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_ACCESS_SECRET') ||
        configService.get<string>('JWT_SECRET') ||
        'access_secret',
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: any) {
    if (payload && payload.jti) {
      const isBlacklisted = await this.cacheManager.get(
        `blacklist:${payload.jti}`,
      );
      if (isBlacklisted) {
        throw new UnauthorizedException('Token revoked');
      }
    }
    return { userId: payload.sub, role: payload.role };
  }
}
