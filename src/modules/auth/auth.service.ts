import { Injectable, ConflictException, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmployeeService } from '../employee/employee.service';
import { SignUpDto } from './dto/signup.dto';
import { SignInDto } from './dto/signin.dto';
import * as bcrypt from 'bcrypt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly employeeService: EmployeeService,
    private readonly jwtService: JwtService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async signUp(signUpDto: SignUpDto) {
    const existing = await this.employeeService.findOneByEmail(signUpDto.email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(signUpDto.password, 10);
    const newEmployee = await this.employeeService.create(
      signUpDto.email,
      passwordHash,
    );

    const { passwordHash: _, ...result } = newEmployee;
    return result;
  }

  async signIn(signInDto: SignInDto) {
    const employee = await this.employeeService.findOneByEmail(signInDto.email);
    
    // Unify comparison to prevent timing attacks/enumeration
    const dummyHash = '$2b$10$tPjGfN1h/C7KxZ/W8s55Ou.2H8g3HnI5w3P9Jv6hH/Kk8X8Gg7c6q';
    const hashToCompare = employee ? employee.passwordHash : dummyHash;
    const isMatch = await bcrypt.compare(signInDto.password, hashToCompare);

    if (!employee || !isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: employee.id, jti: randomUUID() };
    const access_token = await this.jwtService.signAsync(payload);
    
    return {
      access_token,
    };
  }

  async logout(token: string): Promise<void> {
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
