import { Injectable } from '@nestjs/common';
import type { DashboardDto } from '@warekai/contracts';
import { Decimal } from '@warekai/domain';
import { eq, isNull, sql } from 'drizzle-orm';
import { assertPermission, type Principal } from '../../common/principal';
import * as t from '../../db/schema';
import { withTenant } from '../../db/tenant';

/**
 * Cuadro de mando minimo.
 *
 * Tres numeros y una lista. Lo que un jefe de cocina mira antes de sentarse a
 * revisar la carta: cuantos platos hay, a que food cost medio salen y cuales
 * se han ido por encima del objetivo. Sin graficas: el dato es la lista de
 * platos que hay que tocar, no la tendencia.
 */
@Injectable()
export class DashboardService {
  async get(principal: Principal): Promise<DashboardDto> {
    assertPermission(principal, 'cost:read');

    return withTenant(principal.tenantId, async (tx) => {
      const [tenant] = await tx
        .select({ target: t.tenants.targetFoodCost })
        .from(t.tenants)
        .where(eq(t.tenants.id, principal.tenantId))
        .limit(1);
      const targetFoodCost = tenant?.target ?? '0.30';

      const rows = await tx
        .select({
          recipeId: t.recipes.id,
          itemId: t.recipes.itemId,
          itemName: t.items.name,
          listPriceCents: t.recipes.listPriceCents,
          updatedAt: t.recipes.updatedAt,
          costPerPortionCents: sql<string | null>`(
            select cs.cost_per_portion_cents from cost_snapshot cs
            where cs.recipe_id = ${t.recipes.id}
            order by cs.calculated_at desc limit 1
          )`,
          foodCostRatio: sql<string | null>`(
            select cs.food_cost_ratio from cost_snapshot cs
            where cs.recipe_id = ${t.recipes.id}
            order by cs.calculated_at desc limit 1
          )`,
          calculatedAt: sql<Date | null>`(
            select cs.calculated_at from cost_snapshot cs
            where cs.recipe_id = ${t.recipes.id}
            order by cs.calculated_at desc limit 1
          )`,
        })
        .from(t.recipes)
        .innerJoin(t.items, eq(t.recipes.itemId, t.items.id))
        .where(isNull(t.recipes.validTo));

      const saleRows = rows.filter((row) => row.listPriceCents !== null);
      const priced = saleRows.filter((row) => row.foodCostRatio !== null);

      const average =
        priced.length === 0
          ? null
          : priced
              .reduce(
                (acc, row) => acc.plus(new Decimal(row.foodCostRatio as string)),
                new Decimal(0),
              )
              .dividedBy(priced.length)
              .toFixed(6);

      const target = new Decimal(targetFoodCost);
      const aboveTarget = priced
        .filter((row) => new Decimal(row.foodCostRatio as string).greaterThan(target))
        .sort((a, b) =>
          new Decimal(b.foodCostRatio as string).comparedTo(new Decimal(a.foodCostRatio as string)),
        )
        .map((row) => ({
          recipeId: row.recipeId,
          itemId: row.itemId,
          itemName: row.itemName,
          foodCostRatio: new Decimal(row.foodCostRatio as string).toFixed(6),
          costPerPortionCents: Number(row.costPerPortionCents ?? 0),
          listPriceCents: row.listPriceCents as number,
        }));

      // Una receta esta "obsoleta" si se toco despues del ultimo calculo de su
      // coste. Es la senal de que la cola de recalculo se quedo atras.
      const staleRecipeCount = rows.filter(
        (row) => row.calculatedAt === null || row.updatedAt > new Date(row.calculatedAt),
      ).length;

      return {
        saleItemCount: saleRows.length,
        pricedSaleItemCount: priced.length,
        averageFoodCost: average,
        targetFoodCost,
        aboveTarget,
        staleRecipeCount,
      };
    });
  }
}
