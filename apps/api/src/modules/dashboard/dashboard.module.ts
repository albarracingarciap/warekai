import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [JobsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
