import { describe, expect, it } from 'vitest';
import { hasPermission, permissionsFor } from './auth.js';
import { createItemSchema, itemUnitsSchema } from './catalog.js';
import { yieldFactorSchema } from './common.js';
import { createRecipeSchema } from './recipes.js';

describe('validacion de mermas en la frontera', () => {
  it('acepta el rango (0, 1]', () => {
    expect(yieldFactorSchema.parse('0.4')).toBe('0.4');
    expect(yieldFactorSchema.parse('1')).toBe('1');
  });

  it('rechaza el 40 escrito como porcentaje antes de tocar la base de datos', () => {
    const result = yieldFactorSchema.safeParse('40');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('0.4');
  });

  it('rechaza cero y valores no numericos', () => {
    expect(yieldFactorSchema.safeParse('0').success).toBe(false);
    expect(yieldFactorSchema.safeParse('mucho').success).toBe(false);
  });
});

describe('unidades del item', () => {
  it('rellena los puentes ausentes con null', () => {
    const units = itemUnitsSchema.parse({
      purchaseUnitLabel: 'caja',
      stockUnitLabel: 'botella',
      usageUnit: 'ml',
      purchaseToStock: '6',
      stockToUsage: '700',
    });
    expect(units.densityGPerMl).toBeNull();
    expect(units.weightPerPieceG).toBeNull();
  });

  it('exige factores de empaquetado positivos', () => {
    const result = itemUnitsSchema.safeParse({
      purchaseUnitLabel: 'caja',
      stockUnitLabel: 'kg',
      usageUnit: 'g',
      purchaseToStock: '0',
      stockToUsage: '1000',
    });
    expect(result.success).toBe(false);
  });
});

describe('alta de item', () => {
  const base = {
    code: 'ALC-001',
    name: 'Alcachofa',
    kinds: ['RAW' as const],
    units: {
      purchaseUnitLabel: 'caja',
      stockUnitLabel: 'kg',
      usageUnit: 'g' as const,
      purchaseToStock: '5',
      stockToUsage: '1000',
    },
  };

  it('exige precio de compra a lo que se compra', () => {
    const result = createItemSchema.safeParse(base);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['purchasePriceCents']);
  });

  it('no lo exige a una elaboracion, que saca su coste de la receta', () => {
    const result = createItemSchema.safeParse({ ...base, kinds: ['PREP'] });
    expect(result.success).toBe(true);
  });

  it('aplica los valores por defecto del dominio', () => {
    const parsed = createItemSchema.parse({ ...base, purchasePriceCents: 2000 });
    expect(parsed.cleaningYield).toBe('1');
    expect(parsed.vatRate).toBe('0.10');
    expect(parsed.isActive).toBe(true);
  });

  it('rechaza campos que no existen en el contrato', () => {
    const result = createItemSchema.safeParse({ ...base, purchasePriceCents: 2000, precio: 20 });
    expect(result.success).toBe(false);
  });
});

describe('alta de receta', () => {
  it('una receta sin merma de proceso vale 1 por defecto', () => {
    const parsed = createRecipeSchema.parse({
      itemId: '3f1a4a52-0b64-4a4e-9c65-3f4b8b1f9f11',
      outputQuantity: '1000',
      outputUnit: 'ml',
    });
    expect(parsed.yieldFactor).toBe('1');
    expect(parsed.portions).toBe(1);
    expect(parsed.lines).toEqual([]);
  });
});

describe('permisos por rol y establecimiento', () => {
  const casaMadrid = '11111111-1111-4111-8111-111111111111';
  const casaSevilla = '22222222-2222-4222-8222-222222222222';

  it('un CHEF solo manda en su establecimiento', () => {
    const roles = [{ role: 'CHEF' as const, establishmentId: casaMadrid }];
    expect(hasPermission(roles, casaMadrid, 'recipe:write')).toBe(true);
    expect(hasPermission(roles, casaSevilla, 'recipe:write')).toBe(false);
  });

  it('un rol sin establecimiento aplica a todo el tenant', () => {
    const roles = [{ role: 'ADMIN' as const, establishmentId: null }];
    expect(hasPermission(roles, casaSevilla, 'user:manage')).toBe(true);
  });

  it('el cocinero de partida no ve costes', () => {
    const roles = [{ role: 'COCINERO' as const, establishmentId: casaMadrid }];
    expect(hasPermission(roles, casaMadrid, 'recipe:read')).toBe(true);
    expect(hasPermission(roles, casaMadrid, 'cost:read')).toBe(false);
  });

  it('acumula permisos de varios roles sin duplicarlos', () => {
    const permissions = permissionsFor(
      [
        { role: 'COCINERO', establishmentId: casaMadrid },
        { role: 'OFICINA', establishmentId: casaMadrid },
      ],
      casaMadrid,
    );
    expect(permissions).toContain('cost:read');
    expect(new Set(permissions).size).toBe(permissions.length);
  });
});
