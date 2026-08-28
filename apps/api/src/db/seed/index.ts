import { hashSync } from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import {
  ALLERGEN_LABELS,
  ROLE_PERMISSIONS,
  type AllergenCode,
  type Role,
} from '@warekai/contracts';
import {
  buildUnitCostIndex,
  calculateRecipeCost,
  foodCostRatio,
  netPriceFromGross,
  Decimal,
  Money,
} from '@warekai/domain';
import { closeDb, getDb } from '../client';
import * as t from '../schema';
import { withTenant } from '../tenant';
import { SEED_FAMILIES, SEED_RAW_ITEMS, type SeedItem } from './catalog.data';
import { SEED_DISHES, SEED_PREPARATIONS, type SeedRecipe } from './recipes.data';
import { toCatalog, toRecipeBook } from '../../modules/costing/domain-mapping';

const TENANT_SLUG = 'grupo-mediterraneo';

/** Contrasena unica para todas las cuentas de ejemplo. Solo desarrollo. */
const DEMO_PASSWORD = 'warekai2025';
const DEMO_PIN = '2468';
const DEMO_DEVICE_TOKEN = 'tablet-partida-caliente-demo';

async function main(): Promise<void> {
  const db = getDb();

  // --- Catalogos raiz (sin tenant) -------------------------------------------
  await db
    .insert(t.allergens)
    .values(
      Object.entries(ALLERGEN_LABELS).map(([code, name], index) => ({
        code,
        name,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(t.roles)
    .values([
      { name: 'ADMIN' as const, description: 'Acceso completo, incluida la gestion de usuarios' },
      { name: 'CHEF' as const, description: 'Catalogo, recetas y precios de su establecimiento' },
      { name: 'COCINERO' as const, description: 'Fichas tecnicas de partida, sin ver costes' },
      { name: 'OFICINA' as const, description: 'Lectura de costes y escandallos, sin edicion' },
    ])
    .onConflictDoNothing();

  await db
    .insert(t.permissions)
    .values(
      Object.entries(ROLE_PERMISSIONS).flatMap(([role, list]) =>
        list.map((permission) => ({ role: role as Role, permission })),
      ),
    )
    .onConflictDoNothing();

  // --- Tenant limpio ----------------------------------------------------------
  // Se borra y se recrea entero: un seeder que intenta reconciliar acaba
  // sembrando estados que nadie tiene en su maquina.
  await db.delete(t.tenants).where(eq(t.tenants.slug, TENANT_SLUG));

  const [tenant] = await db
    .insert(t.tenants)
    .values({
      slug: TENANT_SLUG,
      name: 'Grupo Mediterraneo',
      currency: 'EUR',
      defaultVatRate: '0.10',
      targetFoodCost: '0.30',
    })
    .returning();
  if (!tenant) throw new Error('No se pudo crear el tenant');
  const tenantId = tenant.id;
  console.log(`Tenant "${tenant.name}" creado.`);

  await withTenant(tenantId, async (tx) => {
    // --- Establecimientos y almacenes ----------------------------------------
    const establishmentRows = await tx
      .insert(t.establishments)
      .values([
        { tenantId, name: 'Casa Mediterraneo Centro', code: 'CENTRO' },
        { tenantId, name: 'Casa Mediterraneo Puerto', code: 'PUERTO' },
      ])
      .returning();

    const establishments = new Map(establishmentRows.map((row) => [row.code, row]));
    const centro = establishments.get('CENTRO');
    const puerto = establishments.get('PUERTO');
    if (!centro || !puerto) throw new Error('No se pudieron crear los establecimientos');

    await tx.insert(t.warehouses).values([
      { tenantId, establishmentId: centro.id, name: 'Camara de frio', kind: 'CAMARA' as const },
      { tenantId, establishmentId: centro.id, name: 'Economato', kind: 'ECONOMATO' as const },
      { tenantId, establishmentId: centro.id, name: 'Congelador', kind: 'CONGELADOR' as const },
      { tenantId, establishmentId: puerto.id, name: 'Camara de pescado', kind: 'CAMARA' as const },
      { tenantId, establishmentId: puerto.id, name: 'Barra', kind: 'BARRA' as const },
    ]);

    // --- Usuarios --------------------------------------------------------------
    const passwordHash = hashSync(DEMO_PASSWORD, 10);
    const userRows = await tx
      .insert(t.users)
      .values([
        {
          tenantId,
          email: 'admin@grupomediterraneo.es',
          displayName: 'Pilar Ordonez',
          passwordHash,
        },
        {
          tenantId,
          email: 'chef@grupomediterraneo.es',
          displayName: 'Andres Vilar',
          passwordHash,
          pinHash: hashSync(DEMO_PIN, 10),
        },
        {
          tenantId,
          email: 'partida@grupomediterraneo.es',
          displayName: 'Partida de caliente',
          passwordHash,
          pinHash: hashSync(DEMO_PIN, 10),
        },
        {
          tenantId,
          email: 'oficina@grupomediterraneo.es',
          displayName: 'Marta Ibanez',
          passwordHash,
        },
      ])
      .returning();

    const usersByEmail = new Map(userRows.map((row) => [row.email, row]));
    const adminUser = usersByEmail.get('admin@grupomediterraneo.es');
    const chefUser = usersByEmail.get('chef@grupomediterraneo.es');
    const lineUser = usersByEmail.get('partida@grupomediterraneo.es');
    const officeUser = usersByEmail.get('oficina@grupomediterraneo.es');
    if (!adminUser || !chefUser || !lineUser || !officeUser) {
      throw new Error('No se pudieron crear los usuarios');
    }

    await tx.insert(t.userRoles).values([
      // El admin manda en todo el tenant: sin establecimiento acotado.
      { tenantId, userId: adminUser.id, role: 'ADMIN' as const, establishmentId: null },
      { tenantId, userId: chefUser.id, role: 'CHEF' as const, establishmentId: centro.id },
      // El mismo jefe de cocina, pero solo lectura de costes en el otro local.
      { tenantId, userId: chefUser.id, role: 'OFICINA' as const, establishmentId: puerto.id },
      { tenantId, userId: lineUser.id, role: 'COCINERO' as const, establishmentId: centro.id },
      { tenantId, userId: officeUser.id, role: 'OFICINA' as const, establishmentId: null },
    ]);

    await tx.insert(t.trustedDevices).values({
      tenantId,
      establishmentId: centro.id,
      name: 'Tablet partida de caliente',
      tokenHash: hashSync(DEMO_DEVICE_TOKEN, 10),
    });

    // --- Familias con jerarquia -------------------------------------------------
    const familyIds = new Map<string, string>();
    const familyPaths = new Map<string, string[]>();
    for (const [name, parentName] of SEED_FAMILIES) {
      const parentId = parentName ? (familyIds.get(parentName) ?? null) : null;
      const parentPath = parentName ? (familyPaths.get(parentName) ?? []) : [];
      const path = [...parentPath, name];
      const [row] = await tx
        .insert(t.itemFamilies)
        .values({ tenantId, name, parentId, path })
        .returning();
      if (!row) throw new Error(`No se pudo crear la familia ${name}`);
      familyIds.set(name, row.id);
      familyPaths.set(name, path);
    }

    // --- Items ------------------------------------------------------------------
    const itemIdByCode = new Map<string, string>();

    const insertItem = async (spec: SeedItem): Promise<void> => {
      const [row] = await tx
        .insert(t.items)
        .values({
          tenantId,
          familyId: familyIds.get(spec.family) ?? null,
          code: spec.code,
          name: spec.name,
          kinds: spec.kinds,
          purchaseUnitLabel: spec.purchaseUnitLabel,
          stockUnitLabel: spec.stockUnitLabel,
          usageUnit: spec.usageUnit,
          purchaseToStock: spec.purchaseToStock,
          stockToUsage: spec.stockToUsage,
          densityGPerMl: spec.densityGPerMl ?? null,
          weightPerPieceG: spec.weightPerPieceG ?? null,
          purchasePriceCents: spec.purchasePriceCents,
          cleaningYield: spec.cleaningYield,
          vatRate: spec.vatRate ?? '0.10',
        })
        .returning();
      if (!row) throw new Error(`No se pudo crear el item ${spec.code}`);
      itemIdByCode.set(spec.code, row.id);

      if (spec.allergens?.length) {
        await tx.insert(t.itemAllergens).values(
          spec.allergens.map((allergen) => ({
            tenantId,
            itemId: row.id,
            allergenCode: allergen.code,
            level: allergen.level,
          })),
        );
      }
    };

    for (const spec of SEED_RAW_ITEMS) {
      await insertItem(spec);
    }

    // Las elaboraciones y los platos tambien son items: mismo modelo, distinto
    // tipo. No tienen precio de compra porque su coste sale de su receta.
    const recipeSpecs = [...SEED_PREPARATIONS, ...SEED_DISHES];
    for (const spec of recipeSpecs) {
      await insertItem({
        code: spec.code,
        name: spec.name,
        family: spec.family,
        kinds: spec.isSale ? ['SALE'] : ['PREP'],
        purchaseUnitLabel: 'lote',
        stockUnitLabel: 'lote',
        usageUnit: spec.outputUnit,
        purchaseToStock: '1',
        stockToUsage: '1',
        purchasePriceCents: null,
        cleaningYield: '1',
        vatRate: spec.vatRate ?? '0.10',
      });
    }

    // --- Recetas ------------------------------------------------------------------
    const insertRecipe = async (spec: SeedRecipe): Promise<void> => {
      const itemId = itemIdByCode.get(spec.code);
      if (!itemId) throw new Error(`Falta el item de la receta ${spec.code}`);

      const [recipe] = await tx
        .insert(t.recipes)
        .values({
          tenantId,
          itemId,
          versionNo: 1,
          yieldFactor: spec.yieldFactor,
          outputQuantity: spec.outputQuantity,
          outputUnit: spec.outputUnit,
          portions: spec.portions,
          listPriceCents: spec.listPriceCents ?? null,
          method: spec.method ?? null,
          createdByUserId: chefUser.id,
        })
        .returning();
      if (!recipe) throw new Error(`No se pudo crear la receta ${spec.code}`);

      await tx.insert(t.recipeLines).values(
        spec.lines.map((line, index) => {
          const lineItemId = itemIdByCode.get(line.item);
          if (!lineItemId) throw new Error(`Falta el item ${line.item} de ${spec.code}`);
          return {
            tenantId,
            recipeId: recipe.id,
            itemId: lineItemId,
            quantity: line.quantity,
            unit: line.unit,
            cleaningYieldOverride: line.cleaningYieldOverride ?? null,
            note: line.note ?? null,
            sortOrder: index,
          };
        }),
      );
    };

    // Las elaboraciones primero: el disparador de ciclos consulta las lineas ya
    // existentes, y las dependencias tienen que estar en su sitio.
    for (const spec of SEED_PREPARATIONS) {
      await insertRecipe(spec);
    }
    for (const spec of SEED_DISHES) {
      await insertRecipe(spec);
    }

    // --- Costes congelados ----------------------------------------------------------
    // Sembrar los snapshots aqui no es adorno: es una comprobacion de extremo a
    // extremo de que el catalogo sembrado se puede costear de verdad. Si el
    // motor lanza un ciclo o falta una densidad, el seeder falla en vez de
    // dejar una base de datos que parece buena.
    await writeCostSnapshots(tx, tenantId);
  });

  console.log('');
  console.log('Datos de ejemplo listos.');
  console.log(`  Tenant .......... ${TENANT_SLUG}`);
  console.log(`  Materias primas . ${SEED_RAW_ITEMS.length}`);
  console.log(`  Elaboraciones ... ${SEED_PREPARATIONS.length}`);
  console.log(`  Platos de carta . ${SEED_DISHES.length}`);
  console.log('');
  console.log('Cuentas de acceso (solo desarrollo):');
  console.log(`  admin@grupomediterraneo.es    / ${DEMO_PASSWORD}   (ADMIN)`);
  console.log(`  chef@grupomediterraneo.es     / ${DEMO_PASSWORD}   (CHEF en Centro)`);
  console.log(`  partida@grupomediterraneo.es  / ${DEMO_PASSWORD}   (COCINERO, sin costes)`);
  console.log(`  oficina@grupomediterraneo.es  / ${DEMO_PASSWORD}   (OFICINA, solo lectura)`);
  console.log(`  PIN de cocina: ${DEMO_PIN}   Token de dispositivo: ${DEMO_DEVICE_TOKEN}`);
}

type Tx = ReturnType<typeof getDb>;

/** Calcula y guarda el escandallo de todas las recetas del tenant. */
async function writeCostSnapshots(tx: Tx, tenantId: string): Promise<void> {
  const itemRows = await tx.query.items.findMany({ with: { allergens: true } });
  const recipeRows = await tx.query.recipes.findMany({
    with: { lines: true },
    where: (table, { isNull }) => isNull(table.validTo),
  });

  const catalog = toCatalog(
    itemRows.map((row) => ({
      id: row.id,
      name: row.name,
      kinds: row.kinds,
      purchaseUnitLabel: row.purchaseUnitLabel,
      stockUnitLabel: row.stockUnitLabel,
      usageUnit: row.usageUnit,
      purchaseToStock: row.purchaseToStock,
      stockToUsage: row.stockToUsage,
      densityGPerMl: row.densityGPerMl,
      weightPerPieceG: row.weightPerPieceG,
      purchasePriceCents: row.purchasePriceCents,
      cleaningYield: row.cleaningYield,
      vatRate: row.vatRate,
      allergens: row.allergens.map((a) => ({
        code: a.allergenCode as AllergenCode,
        level: a.level,
      })),
    })),
  );
  const recipes = toRecipeBook(
    recipeRows.map((row) => ({
      itemId: row.itemId,
      yieldFactor: row.yieldFactor,
      outputQuantity: row.outputQuantity,
      outputUnit: row.outputUnit,
      portions: row.portions,
      lines: row.lines.map((line) => ({
        itemId: line.itemId,
        quantity: line.quantity,
        unit: line.unit,
        cleaningYieldOverride: line.cleaningYieldOverride,
      })),
    })),
  );
  const index = buildUnitCostIndex(catalog, recipes);

  const vatByItemId = new Map(itemRows.map((row) => [row.id, row.vatRate]));

  for (const row of recipeRows) {
    const breakdown = calculateRecipeCost(row.itemId, catalog, recipes, index);
    const listPriceCents = row.listPriceCents;
    const vatRate = new Decimal(vatByItemId.get(row.itemId) ?? '0.10');

    const ratio =
      listPriceCents === null
        ? null
        : foodCostRatio(
            breakdown.costPerPortion,
            netPriceFromGross(Money.fromCents(listPriceCents), vatRate),
          );

    await tx.insert(t.costSnapshots).values({
      tenantId,
      recipeId: row.id,
      recipeVersionNo: row.versionNo,
      totalCostCents: breakdown.totalCost.cents,
      costPerPortionCents: breakdown.costPerPortion.cents,
      costPerOutputUnitCents: breakdown.costPerOutputUnit.exactCents.toFixed(6),
      listPriceCents,
      foodCostRatio: ratio ? ratio.toFixed(6) : null,
      breakdown: sql`${JSON.stringify(serializeBreakdown(breakdown))}::jsonb`,
    });
  }
}

function serializeBreakdown(breakdown: ReturnType<typeof calculateRecipeCost>) {
  return {
    itemId: breakdown.itemId,
    itemName: breakdown.itemName,
    totalCostCents: breakdown.totalCost.exactCents.toFixed(6),
    costPerPortionCents: breakdown.costPerPortion.exactCents.toFixed(6),
    portions: breakdown.portions,
    netOutput: breakdown.netOutput.toJSON(),
    lines: breakdown.lines.map((line) => ({
      itemId: line.itemId,
      itemName: line.itemName,
      depth: line.depth,
      path: line.path,
      isPreparation: line.isPreparation,
      netQuantity: line.netQuantity.toJSON(),
      grossQuantity: line.grossQuantity.toJSON(),
      cleaningYield: line.cleaningYield.toString(),
      unitCostCents: line.unitCost.exactCents.toFixed(8),
      lineCostCents: line.lineCost.exactCents.toFixed(6),
    })),
  };
}

main()
  .catch((error: unknown) => {
    console.error('Fallo al sembrar:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
