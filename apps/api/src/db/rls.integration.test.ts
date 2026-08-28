import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './client';
import * as t from './schema';
import { withTenant } from './tenant';

/**
 * El aislamiento entre tenants no se comprueba leyendo el codigo.
 *
 * Se comprueba metiendo datos de dos clientes distintos en la misma tabla y
 * mirando si uno ve al otro. Todo lo demas -- que las consultas filtran, que
 * nadie se salto el `withTenant` -- es una promesa; esto es la unica prueba.
 */
describe('seguridad a nivel de fila', () => {
  const db = getDb();
  const slugA = `test-a-${randomUUID().slice(0, 8)}`;
  const slugB = `test-b-${randomUUID().slice(0, 8)}`;
  let tenantA = '';
  let tenantB = '';

  const baseItem = {
    purchaseUnitLabel: 'caja',
    stockUnitLabel: 'kg',
    usageUnit: 'g' as const,
    purchaseToStock: '5',
    stockToUsage: '1000',
    kinds: ['RAW' as const],
    cleaningYield: '0.4',
  };

  beforeAll(async () => {
    const [a] = await db.insert(t.tenants).values({ slug: slugA, name: 'Cliente A' }).returning();
    const [b] = await db.insert(t.tenants).values({ slug: slugB, name: 'Cliente B' }).returning();
    if (!a || !b) throw new Error('No se pudieron crear los tenants de prueba');
    tenantA = a.id;
    tenantB = b.id;

    await withTenant(tenantA, (tx) =>
      tx.insert(t.items).values({
        ...baseItem,
        tenantId: tenantA,
        code: 'A-001',
        name: 'Alcachofa del cliente A',
      }),
    );
    await withTenant(tenantB, (tx) =>
      tx.insert(t.items).values({
        ...baseItem,
        tenantId: tenantB,
        code: 'B-001',
        name: 'Alcachofa del cliente B',
      }),
    );
  });

  afterAll(async () => {
    await db.delete(t.tenants).where(eq(t.tenants.slug, slugA));
    await db.delete(t.tenants).where(eq(t.tenants.slug, slugB));
    await closeDb();
  });

  it('cada tenant ve solo sus items', async () => {
    const fromA = await withTenant(tenantA, (tx) => tx.select().from(t.items));
    const fromB = await withTenant(tenantB, (tx) => tx.select().from(t.items));

    expect(fromA.map((row) => row.code)).toEqual(['A-001']);
    expect(fromB.map((row) => row.code)).toEqual(['B-001']);
  });

  it('una consulta sin contexto de tenant no devuelve nada', async () => {
    // Falla cerrado: `current_setting('app.tenant_id', true)` es NULL y la
    // comparacion tambien, asi que ninguna fila pasa el filtro.
    const rows = await db.select().from(t.items);
    expect(rows).toHaveLength(0);
  });

  it('no se puede escribir en el tenant de otro aunque se indique su id', async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(t.items).values({
          ...baseItem,
          tenantId: tenantB,
          code: 'INTRUSO',
          name: 'Item colado en el tenant B',
        }),
      ),
    ).rejects.toThrow();
  });

  it('la politica se aplica tambien al propietario de las tablas', async () => {
    // Sin FORCE ROW LEVEL SECURITY, Postgres saltaria la politica para el rol
    // que creo las tablas -- que en desarrollo es el mismo que usa la
    // aplicacion -- y el aislamiento seria decorativo.
    const [row] = await db
      .execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'item'`,
      )
      .then((result) => result.rows);

    expect(row?.relrowsecurity).toBe(true);
    expect(row?.relforcerowsecurity).toBe(true);
  });

  it('el disparador rechaza un ciclo en las elaboraciones', async () => {
    await expect(
      withTenant(tenantA, async (tx) => {
        const [item] = await tx
          .insert(t.items)
          .values({
            ...baseItem,
            tenantId: tenantA,
            code: 'PREP-CICLO',
            name: 'Salsa que se contiene a si misma',
            kinds: ['PREP'],
            cleaningYield: '1',
          })
          .returning();
        if (!item) throw new Error('sin item');

        const [recipe] = await tx
          .insert(t.recipes)
          .values({
            tenantId: tenantA,
            itemId: item.id,
            outputQuantity: '1000',
            outputUnit: 'g',
          })
          .returning();
        if (!recipe) throw new Error('sin receta');

        await tx.insert(t.recipeLines).values({
          tenantId: tenantA,
          recipeId: recipe.id,
          itemId: item.id,
          quantity: '100',
          unit: 'g',
        });
      }),
    ).rejects.toThrow(/[Cc]iclo/);
  });
});
