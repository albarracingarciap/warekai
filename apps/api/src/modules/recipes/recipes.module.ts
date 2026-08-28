import { Module } from '@nestjs/common';
import { CostingModule } from '../costing/costing.module';
import { JobsModule } from '../jobs/jobs.module';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';

@Module({
  imports: [CostingModule, JobsModule],
  controllers: [RecipesController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
