import { Injectable, Logger } from '@nestjs/common';
import { dependentsOf, topologicalOrder } from '@warekai/domain';
import { withTenant } from '../../db/tenant';
import { CostingService } from '../costing/costing.service';

export interface RecalculationJobData {
  tenantId: string;
  /** Item que ha cambiado. Vacio significa "todo el recetario". */
  itemId?: string;
}

/**
 * Recalculo en cascada.
 *
 * Cambiar el precio de la harina no afecta solo a la harina: afecta a la salsa
 * espanola, a la carrillera que la lleva y al menu que incluye la carrillera.
 * Aqui se resuelve que hay que recalcular y en que orden.
 */
@Injectable()
export class RecalculationService {
  private readonly logger = new Logger(RecalculationService.name);

  constructor(private readonly costing: CostingService) {}

  /** Recetas afectadas por un cambio en un item, en orden topologico. */
  async affectedRecipeItemIds(tenantId: string, itemId?: string): Promise<string[]> {
    return withTenant(tenantId, async (tx) => {
      const { recipes } = await this.costing.loadDomainState(tx);
      if (!itemId) {
        return topologicalOrder(recipes);
      }
      const dependents = new Set(dependentsOf(itemId, recipes));
      // El propio item puede ser una elaboracion: si lo es, tambien se
      // recalcula, y antes que quienes la usan.
      if (recipes.has(itemId)) dependents.add(itemId);
      // El orden topologico garantiza que cada elaboracion se recalcula
      // despues de aquello de lo que depende.
      return topologicalOrder(recipes).filter((id) => dependents.has(id));
    });
  }

  async run(data: RecalculationJobData): Promise<{ affected: string[]; written: number }> {
    const affected = await this.affectedRecipeItemIds(data.tenantId, data.itemId);
    if (affected.length === 0) {
      return { affected, written: 0 };
    }
    const written = await this.costing.refreshSnapshots(data.tenantId, affected);
    this.logger.log(
      `Recalculadas ${written} recetas del tenant ${data.tenantId}` +
        (data.itemId ? ` tras cambiar el item ${data.itemId}` : ''),
    );
    return { affected, written };
  }
}
