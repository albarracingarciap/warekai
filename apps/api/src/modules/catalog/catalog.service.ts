import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConversionPreviewDto,
  CreateItemDto,
  CreateItemFamilyDto,
  ItemDto,
  ItemFamilyDto,
  ItemListEntryDto,
  ItemQuery,
  Paginated,
  UpdateItemDto,
} from '@warekai/contracts';
import { Quantity, convert } from '@warekai/domain';
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { recordAuditFor } from '../../common/audit';
import { assertPermission, type Principal } from '../../common/principal';
import type { Database } from '../../db/client';
import * as t from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { RecalculationQueue } from '../jobs/recalculation.queue';
import { toCatalogItem } from '../costing/domain-mapping';

@Injectable()
export class CatalogService {
  constructor(private readonly recalculation: RecalculationQueue) {}

  async list(principal: Principal, query: ItemQuery): Promise<Paginated<ItemListEntryDto>> {
    assertPermission(principal, 'catalog:read');

    return withTenant(principal.tenantId, async (tx) => {
      const filters: SQL[] = [];
      if (!query.includeInactive) filters.push(eq(t.items.isActive, true));
      if (query.familyId) filters.push(eq(t.items.familyId, query.familyId));
      if (query.kind) {
        filters.push(sql`${t.items.kinds} @> ARRAY[${sql.raw(`'${query.kind}'`)}]::item_kind[]`);
      }
      if (query.search) {
        const pattern = `%${query.search}%`;
        const search = or(ilike(t.items.name, pattern), ilike(t.items.code, pattern));
        if (search) filters.push(search);
      }
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [{ value: total } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(t.items)
        .where(where);

      const rows = await tx
        .select({
          id: t.items.id,
          code: t.items.code,
          name: t.items.name,
          kinds: t.items.kinds,
          purchasePriceCents: t.items.purchasePriceCents,
          cleaningYield: t.items.cleaningYield,
          isActive: t.items.isActive,
          familyName: t.itemFamilies.name,
        })
        .from(t.items)
        .leftJoin(t.itemFamilies, eq(t.items.familyId, t.itemFamilies.id))
        .where(where)
        .orderBy(asc(t.items.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return {
        items: rows.map((row) => ({ ...row, familyName: row.familyName ?? null })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async findOne(principal: Principal, id: string): Promise<ItemDto> {
    assertPermission(principal, 'catalog:read');
    return withTenant(principal.tenantId, (tx) => this.loadItem(tx, id));
  }

  async create(principal: Principal, dto: CreateItemDto): Promise<ItemDto> {
    assertPermission(principal, 'catalog:write');

    return withTenant(principal.tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: t.items.id })
        .from(t.items)
        .where(eq(t.items.code, dto.code))
        .limit(1);
      if (existing) {
        throw new ConflictException({
          code: 'ITEM_CODE_TAKEN',
          message: `Ya existe un item con el codigo ${dto.code}.`,
        });
      }

      const [row] = await tx
        .insert(t.items)
        .values({
          tenantId: principal.tenantId,
          familyId: dto.familyId,
          code: dto.code,
          name: dto.name,
          kinds: dto.kinds,
          purchaseUnitLabel: dto.units.purchaseUnitLabel,
          stockUnitLabel: dto.units.stockUnitLabel,
          usageUnit: dto.units.usageUnit,
          purchaseToStock: dto.units.purchaseToStock,
          stockToUsage: dto.units.stockToUsage,
          densityGPerMl: dto.units.densityGPerMl,
          weightPerPieceG: dto.units.weightPerPieceG,
          purchasePriceCents: dto.purchasePriceCents,
          cleaningYield: dto.cleaningYield,
          vatRate: dto.vatRate,
          isActive: dto.isActive,
        })
        .returning();
      if (!row) throw new Error('No se pudo crear el item');

      await this.replaceAllergens(tx, principal.tenantId, row.id, dto.allergens);
      await recordAuditFor(tx, principal, 'CREATE', 'item', row.id, dto);
      return this.loadItem(tx, row.id);
    });
  }

  /**
   * Modifica un item y, si el cambio afecta al coste, encola el recalculo de
   * todo lo que lo usa.
   *
   * Cambiar el precio de la harina toca la salsa, el plato que la lleva y el
   * menu del dia. Hacerlo en linea bloquearia la peticion; hacerlo nunca deja
   * escandallos que mienten.
   */
  async update(principal: Principal, id: string, dto: UpdateItemDto): Promise<ItemDto> {
    assertPermission(principal, 'catalog:write');

    return withTenant(principal.tenantId, async (tx) => {
      const before = await this.loadItem(tx, id);

      const patch: Partial<typeof t.items.$inferInsert> = { updatedAt: new Date() };
      if (dto.code !== undefined) patch.code = dto.code;
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.familyId !== undefined) patch.familyId = dto.familyId;
      if (dto.kinds !== undefined) patch.kinds = dto.kinds;
      if (dto.purchasePriceCents !== undefined) patch.purchasePriceCents = dto.purchasePriceCents;
      if (dto.cleaningYield !== undefined) patch.cleaningYield = dto.cleaningYield;
      if (dto.vatRate !== undefined) patch.vatRate = dto.vatRate;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;
      if (dto.units !== undefined) {
        patch.purchaseUnitLabel = dto.units.purchaseUnitLabel;
        patch.stockUnitLabel = dto.units.stockUnitLabel;
        patch.usageUnit = dto.units.usageUnit;
        patch.purchaseToStock = dto.units.purchaseToStock;
        patch.stockToUsage = dto.units.stockToUsage;
        patch.densityGPerMl = dto.units.densityGPerMl;
        patch.weightPerPieceG = dto.units.weightPerPieceG;
      }

      await tx.update(t.items).set(patch).where(eq(t.items.id, id));
      if (dto.allergens !== undefined) {
        await this.replaceAllergens(tx, principal.tenantId, id, dto.allergens);
      }
      await recordAuditFor(tx, principal, 'UPDATE', 'item', id, { before, after: dto });

      const after = await this.loadItem(tx, id);
      if (affectsCost(before, after)) {
        await this.recalculation.enqueueForItem(principal.tenantId, id);
      }
      return after;
    });
  }

  /**
   * Baja logica. No se borra nunca: un item referenciado por un escandallo
   * historico tiene que seguir existiendo para poder reconstruirlo.
   */
  async deactivate(principal: Principal, id: string): Promise<ItemDto> {
    assertPermission(principal, 'catalog:write');

    return withTenant(principal.tenantId, async (tx) => {
      const [used] = await tx
        .select({ id: t.recipeLines.id })
        .from(t.recipeLines)
        .innerJoin(t.recipes, eq(t.recipeLines.recipeId, t.recipes.id))
        .where(and(eq(t.recipeLines.itemId, id), sql`${t.recipes.validTo} is null`))
        .limit(1);
      if (used) {
        throw new ConflictException({
          code: 'ITEM_IN_USE',
          message:
            'Este item esta en recetas vigentes. Quitalo de ellas antes de darlo de baja, ' +
            'o quedaran escandallos que no se pueden calcular.',
        });
      }

      await tx
        .update(t.items)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(t.items.id, id));
      await recordAuditFor(tx, principal, 'UPDATE', 'item', id, { isActive: false });
      return this.loadItem(tx, id);
    });
  }

  async listFamilies(principal: Principal): Promise<ItemFamilyDto[]> {
    assertPermission(principal, 'catalog:read');
    return withTenant(principal.tenantId, async (tx) => {
      const rows = await tx.select().from(t.itemFamilies).orderBy(asc(t.itemFamilies.name));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        path: row.path,
      }));
    });
  }

  async createFamily(principal: Principal, dto: CreateItemFamilyDto): Promise<ItemFamilyDto> {
    assertPermission(principal, 'catalog:write');

    return withTenant(principal.tenantId, async (tx) => {
      let parentPath: string[] = [];
      if (dto.parentId) {
        const [parent] = await tx
          .select()
          .from(t.itemFamilies)
          .where(eq(t.itemFamilies.id, dto.parentId))
          .limit(1);
        if (!parent) {
          throw new NotFoundException({
            code: 'UNKNOWN_FAMILY',
            message: 'La familia madre no existe.',
          });
        }
        parentPath = parent.path;
      }

      const [row] = await tx
        .insert(t.itemFamilies)
        .values({
          tenantId: principal.tenantId,
          parentId: dto.parentId,
          name: dto.name,
          path: [...parentPath, dto.name],
        })
        .returning();
      if (!row) throw new Error('No se pudo crear la familia');

      await recordAuditFor(tx, principal, 'CREATE', 'item_family', row.id, dto);
      return { id: row.id, name: row.name, parentId: row.parentId, path: row.path };
    });
  }

  /**
   * Conversion puntual entre unidades usando los puentes del item.
   *
   * La usa el editor de escandallo cuando el cocinero cambia la unidad de una
   * linea: la cuenta la hace el motor, no el navegador.
   */
  async previewConversion(
    principal: Principal,
    dto: ConversionPreviewDto,
  ): Promise<{ amount: string; unit: string }> {
    assertPermission(principal, 'catalog:read');

    return withTenant(principal.tenantId, async (tx) => {
      const item = toCatalogItem(await this.loadItemForDomain(tx, dto.itemId));
      const converted = convert(
        Quantity.of(dto.amount, dto.fromUnit),
        dto.toUnit,
        item.units,
        item.id,
      );
      return { amount: converted.amount.toString(), unit: converted.unit };
    });
  }

  // --- Internos ----------------------------------------------------------------

  private async replaceAllergens(
    tx: Database,
    tenantId: string,
    itemId: string,
    allergens: CreateItemDto['allergens'],
  ): Promise<void> {
    await tx.delete(t.itemAllergens).where(eq(t.itemAllergens.itemId, itemId));
    if (allergens.length === 0) return;
    await tx.insert(t.itemAllergens).values(
      allergens.map((allergen) => ({
        tenantId,
        itemId,
        allergenCode: allergen.code,
        level: allergen.level,
      })),
    );
  }

  private async loadItem(tx: Database, id: string): Promise<ItemDto> {
    const row = await tx.query.items.findFirst({
      where: eq(t.items.id, id),
      with: { allergens: true, family: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'UNKNOWN_ITEM', message: 'El item no existe.' });
    }
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      familyId: row.familyId,
      familyName: row.family?.name ?? null,
      kinds: row.kinds,
      units: {
        purchaseUnitLabel: row.purchaseUnitLabel,
        stockUnitLabel: row.stockUnitLabel,
        usageUnit: row.usageUnit,
        purchaseToStock: row.purchaseToStock,
        stockToUsage: row.stockToUsage,
        densityGPerMl: row.densityGPerMl,
        weightPerPieceG: row.weightPerPieceG,
      },
      purchasePriceCents: row.purchasePriceCents,
      cleaningYield: row.cleaningYield,
      vatRate: row.vatRate,
      allergens: row.allergens.map((a) => ({
        code: a.allergenCode as ItemDto['allergens'][number]['code'],
        level: a.level,
      })),
      isActive: row.isActive,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadItemForDomain(tx: Database, id: string) {
    const dto = await this.loadItem(tx, id);
    return {
      id: dto.id,
      name: dto.name,
      kinds: dto.kinds,
      purchaseUnitLabel: dto.units.purchaseUnitLabel,
      stockUnitLabel: dto.units.stockUnitLabel,
      usageUnit: dto.units.usageUnit,
      purchaseToStock: dto.units.purchaseToStock,
      stockToUsage: dto.units.stockToUsage,
      densityGPerMl: dto.units.densityGPerMl,
      weightPerPieceG: dto.units.weightPerPieceG,
      purchasePriceCents: dto.purchasePriceCents,
      cleaningYield: dto.cleaningYield,
      vatRate: dto.vatRate,
      allergens: dto.allergens,
    };
  }
}

/**
 * Un cambio que altera el coste de lo que se construye con este item.
 *
 * El nombre o la familia no cambian nada; el precio, las unidades y la merma
 * de limpieza si. Distinguirlos evita encolar un recalculo del recetario
 * entero cada vez que alguien corrige una tilde.
 */
function affectsCost(before: ItemDto, after: ItemDto): boolean {
  return (
    before.purchasePriceCents !== after.purchasePriceCents ||
    before.cleaningYield !== after.cleaningYield ||
    before.vatRate !== after.vatRate ||
    JSON.stringify(before.units) !== JSON.stringify(after.units)
  );
}
