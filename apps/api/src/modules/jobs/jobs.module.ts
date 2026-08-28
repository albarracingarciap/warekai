import { Module } from '@nestjs/common';
import { CostingModule } from '../costing/costing.module';
import { RecalculationQueue } from './recalculation.queue';
import { RecalculationService } from './recalculation.service';

@Module({
  imports: [CostingModule],
  providers: [RecalculationService, RecalculationQueue],
  exports: [RecalculationQueue, RecalculationService],
})
export class JobsModule {}
