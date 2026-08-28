import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { dashboardSchema, type DashboardDto, type RecalculationJobDto } from '@warekai/contracts';
import { ApiZodResponse, registerSchema } from '../../common/openapi';
import { assertPermission, CurrentUser, type Principal } from '../../common/principal';
import { RecalculationQueue } from '../jobs/recalculation.queue';
import { DashboardService } from './dashboard.service';

const Dashboard = registerSchema('Dashboard', dashboardSchema);

@ApiTags('Cuadro de mando')
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly recalculation: RecalculationQueue,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Numero de platos, food cost medio y platos por encima del objetivo' })
  @ApiZodResponse(Dashboard)
  get(@CurrentUser() principal: Principal): Promise<DashboardDto> {
    return this.dashboard.get(principal);
  }

  @Post('recalculate')
  @ApiOperation({
    summary: 'Forzar el recalculo de todo el recetario',
    description: 'Encola el recalculo en orden topologico. Util tras una carga masiva de precios.',
  })
  recalculateAll(@CurrentUser() principal: Principal): Promise<RecalculationJobDto> {
    assertPermission(principal, 'recipe:write');
    return this.recalculation.enqueueForTenant(principal.tenantId);
  }
}
