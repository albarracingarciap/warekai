import { requireItem, requireRecipe } from './explode.js';
import type {
  AllergenCode,
  AllergenPresence,
  AllergenPresenceLevel,
  Catalog,
  RecipeBook,
} from './types.js';

/** `CONTAINS` gana sobre `TRACES` al unir dos ramas del grafo. */
function strongest(a: AllergenPresenceLevel, b: AllergenPresenceLevel): AllergenPresenceLevel {
  return a === 'CONTAINS' || b === 'CONTAINS' ? 'CONTAINS' : 'TRACES';
}

/**
 * Propaga los alergenos hacia arriba por el grafo de elaboraciones.
 *
 * Un plato declara los alergenos de todo lo que contiene, a cualquier
 * profundidad: si el fondo lleva apio, el plato que usa la salsa que usa ese
 * fondo lleva apio. Se incluyen tambien los alergenos declarados en el propio
 * item de la receta, que es donde se anotan los que introduce el proceso y no
 * un ingrediente concreto (una fritura en aceite compartido, por ejemplo).
 *
 * La merma no interviene: un alergeno no se reduce al cocer.
 */
export function propagateAllergens(
  rootItemId: string,
  catalog: Catalog,
  recipes: RecipeBook,
): AllergenPresence[] {
  const found = new Map<AllergenCode, AllergenPresenceLevel>();
  const visited = new Set<string>();

  const collect = (itemId: string): void => {
    if (visited.has(itemId)) return;
    visited.add(itemId);

    for (const presence of requireItem(catalog, itemId).allergens) {
      const current = found.get(presence.code);
      found.set(presence.code, current ? strongest(current, presence.level) : presence.level);
    }

    const node = recipes.get(itemId);
    if (!node) return;
    for (const line of node.lines) {
      collect(line.itemId);
    }
  };

  collect(rootItemId);

  return [...found.entries()]
    .map(([code, level]): AllergenPresence => ({ code, level }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Variante que exige que la raiz sea una receta. La usa la ficha tecnica, que
 * solo tiene sentido sobre un plato o una elaboracion.
 */
export function propagateRecipeAllergens(
  rootItemId: string,
  catalog: Catalog,
  recipes: RecipeBook,
): AllergenPresence[] {
  requireRecipe(recipes, rootItemId);
  return propagateAllergens(rootItemId, catalog, recipes);
}
