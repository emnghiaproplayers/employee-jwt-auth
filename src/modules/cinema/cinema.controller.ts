import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/role.enum';

@Controller('cinema')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CinemaController {
  @Get('manager/reports')
  @Roles(Role.MANAGER)
  getReports() {
    return {
      revenue: 150000000,
      period: 'June 2026',
    };
  }

  @Get('staff/tickets')
  @Roles(Role.MANAGER, Role.STAFF)
  getTickets() {
    return {
      ticketsSold: 120,
      totalAmount: 12000000,
    };
  }

  @Get('public/showtimes')
  @Public()
  getShowtimes() {
    return [
      { id: 1, movie: 'Avengers: Secret Wars', time: '18:00' },
      { id: 2, movie: 'Avatar 3', time: '21:00' },
    ];
  }
}
