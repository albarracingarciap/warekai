import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as domain from './index.js';
import { calculateRecipeCost } from './costing.js';
import { BASIC_CATALOG, BASIC_RECIPES } from './__fixtures__/kitchen.js';

/**
 * El paquete `domain` no puede depender de infraestructura. Estas pruebas no
 * comprueban logica de cocina: comprueban que la pieza sigue siendo portable, y
 * fallan el dia que alguien importe Prisma "solo un momento" para depurar.
 */
describe('cero dependencias de infraestructura', () => {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies: Record<string, string> };

  it('la unica dependencia de produccion es decimal.js', () => {
    expect(Object.keys(packageJson.dependencies)).toEqual(['decimal.js']);
  });

  it('ningun modulo del motor importa Node, red ni base de datos', () => {
    const prohibidos =
      /from '(node:|fs|path|http|https|net|crypto|@prisma|drizzle|@nestjs|react|zod)/;
    const dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const modulos = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(modulos.length).toBeGreaterThan(5);
    for (const modulo of modulos) {
      const source = readFileSync(join(dir, modulo), 'utf8');
      expect(source, `${modulo} importa infraestructura`).not.toMatch(prohibidos);
    }
  });

  it('el escandallo se resuelve sin red, sin disco y sin variables de entorno', () => {
    const breakdown = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    expect(breakdown.costPerPortion.cents).toBe(86);
  });
});

describe('funciones puras', () => {
  it('la misma entrada da siempre la misma salida', () => {
    const uno = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    const dos = calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    expect(uno.totalCost.exactCents.toString()).toBe(dos.totalCost.exactCents.toString());
  });

  it('no muta el catalogo ni el recetario que recibe', () => {
    const catalogAntes = JSON.stringify([...BASIC_CATALOG.keys()]);
    const recipeAntes = BASIC_RECIPES.get('salsa_alcachofa')!.lines.map((l) =>
      l.quantity.toString(),
    );
    calculateRecipeCost('plato_alcachofas', BASIC_CATALOG, BASIC_RECIPES);
    expect(JSON.stringify([...BASIC_CATALOG.keys()])).toBe(catalogAntes);
    expect(BASIC_RECIPES.get('salsa_alcachofa')!.lines.map((l) => l.quantity.toString())).toEqual(
      recipeAntes,
    );
  });
});

describe('superficie publica', () => {
  it('exporta el motor completo desde el indice', () => {
    for (const nombre of [
      'Money',
      'Quantity',
      'Decimal',
      'convert',
      'grossFromNet',
      'netOutput',
      'topologicalOrder',
      'explodeRecipe',
      'calculateRecipeCost',
      'priceForTargetFoodCost',
      'scaleRecipe',
      'propagateAllergens',
      'CyclicRecipeError',
    ]) {
      expect(domain, `falta ${nombre} en el indice`).toHaveProperty(nombre);
    }
  });
});
