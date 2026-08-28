import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CostingModule } from './modules/costing/costing.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthController } from './health.controller';
import { JobsModule } from './modules/jobs/jobs.module';
import { RecipesModule } from './modules/recipes/recipes.module';

/**
 * Modulos de esta iteracion: catalogo, recetas, escandallos y cuadro de mando.
 *
 * Inventario, compras, produccion, mermas, APPCC y analitica existen como
 * carpetas vacias en `src/modules` con su README. Estan ahi para que la
 * siguiente iteracion sepa donde va cada cosa, no para arrancar a medias.
 */
@Module({
  imports: [AuthModule, CostingModule, JobsModule, CatalogModule, RecipesModule, DashboardModule],
  controllers: [HealthController],
  providers: [
    // Autenticacion global. La autorizacion vive en los servicios.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
