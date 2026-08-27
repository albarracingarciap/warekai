import { CyclicRecipeError } from './errors.js';
import type { RecipeBook } from './types.js';

type Mark = 'VISITING' | 'DONE';

/**
 * Items de los que depende una receta y que son, a su vez, elaboraciones.
 * Las materias primas son hojas y no generan arista.
 */
export function dependenciesOf(itemId: string, recipes: RecipeBook): string[] {
  const node = recipes.get(itemId);
  if (!node) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of node.lines) {
    if (recipes.has(line.itemId) && !seen.has(line.itemId)) {
      seen.add(line.itemId);
      result.push(line.itemId);
    }
  }
  return result;
}

interface Traversal {
  readonly order: string[];
  readonly cycle: string[] | null;
}

/**
 * Recorrido en profundidad con marcado de tres estados. Devuelve el ciclo en
 * lugar de lanzarlo para que `topologicalOrder` y `findCycle` compartan una
 * sola implementacion sin que ninguna de las dos tenga ramas inalcanzables.
 */
function traverse(recipes: RecipeBook, roots?: readonly string[]): Traversal {
  const marks = new Map<string, Mark>();
  const order: string[] = [];
  const stack: string[] = [];

  const visit = (itemId: string): string[] | null => {
    const mark = marks.get(itemId);
    if (mark === 'DONE') return null;
    if (mark === 'VISITING') {
      // Arista hacia atras: el ciclo va desde la primera aparicion del nodo en
      // la pila hasta el final, y se cierra sobre si mismo.
      return [...stack.slice(stack.indexOf(itemId)), itemId];
    }

    marks.set(itemId, 'VISITING');
    stack.push(itemId);
    for (const dependency of dependenciesOf(itemId, recipes)) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    marks.set(itemId, 'DONE');
    order.push(itemId);
    return null;
  };

  for (const root of roots ?? [...recipes.keys()]) {
    if (recipes.has(root)) {
      const cycle = visit(root);
      if (cycle) return { order, cycle };
    }
  }
  return { order, cycle: null };
}

/**
 * Orden topologico del grafo dirigido aciclico de elaboraciones: las
 * dependencias aparecen **antes** que quien las usa, de modo que recorrer el
 * resultado de principio a fin permite calcular cada coste una sola vez con
 * todos sus insumos ya resueltos.
 *
 * Si se pasan `roots`, solo se recorre el subgrafo alcanzable desde ellas.
 * Es lo que usa el recalculo en cascada: cambiar el precio de la harina no
 * obliga a recorrer el recetario entero.
 *
 * @throws {CyclicRecipeError} con la ruta completa del ciclo.
 */
export function topologicalOrder(recipes: RecipeBook, roots?: readonly string[]): string[] {
  const { order, cycle } = traverse(recipes, roots);
  if (cycle) {
    throw new CyclicRecipeError(cycle);
  }
  return order;
}

/**
 * Comprueba si el grafo tiene ciclos sin lanzar. Devuelve la ruta del ciclo o
 * `null`. La usa la API para validar antes de guardar una linea de receta.
 */
export function findCycle(recipes: RecipeBook, roots?: readonly string[]): string[] | null {
  return traverse(recipes, roots).cycle;
}

/**
 * Recetas que dependen (directa o indirectamente) de un item.
 *
 * Es la consulta inversa: al cambiar el precio de compra de la alcachofa, esto
 * devuelve todo lo que hay que recalcular.
 */
export function dependentsOf(itemId: string, recipes: RecipeBook): string[] {
  // El mapa inverso se construye sobre TODAS las lineas, no solo sobre las que
  // apuntan a otra elaboracion: el caso que importa es justamente el de una
  // materia prima, que no es nodo del grafo pero si dispara el recalculo.
  const reverse = new Map<string, string[]>();
  for (const [recipeItemId, node] of recipes) {
    for (const line of node.lines) {
      const list = reverse.get(line.itemId);
      if (!list) {
        reverse.set(line.itemId, [recipeItemId]);
      } else if (!list.includes(recipeItemId)) {
        list.push(recipeItemId);
      }
    }
  }

  const result: string[] = [];
  const seen = new Set<string>([itemId]);
  const queue: string[] = [itemId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of reverse.get(current) ?? []) {
      if (!seen.has(dependent)) {
        seen.add(dependent);
        result.push(dependent);
        queue.push(dependent);
      }
    }
  }
  return result;
}
