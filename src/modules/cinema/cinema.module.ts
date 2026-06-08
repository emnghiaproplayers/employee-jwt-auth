import { Module } from '@nestjs/common';
import { CinemaController } from './cinema.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CinemaController],
})
export class CinemaModule {}
