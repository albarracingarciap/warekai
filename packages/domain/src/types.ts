import type { Decimal } from './decimal.js';
import type { Money } from './money.js';
import type { Quantity, Unit } from './units.js';

/**
 * Naturaleza de un item. Es un conjunto, no un enumerado excluyente: una
 * botella de vino es a la vez materia prima (entra en una salsa) y articulo de
 * venta (se sirve por copas). Modelarlo como tres entidades separadas obliga a
 * duplicar el item y a mantener dos precios de compra sincronizados.
 */
export type ItemKind = 'RAW' | 'PREP' | 'SALE';

/** Los 14 alergenos de declaracion obligatoria (Reglamento UE 1169/2011). */
export type AllergenCode =
  | 'GLUTEN'
  | 'CRUSTACEOS'
  | 'HUEVOS'
  | 'PESCADO'
  | 'CACAHUETES'
  | 'SOJA'
  | 'LACTEOS'
  | 'FRUTOS_DE_CASCARA'
  | 'APIO'
  | 'MOSTAZA'
  | 'SESAMO'
  | 'SULFITOS'
  | 'ALTRAMUCES'
  | 'MOLUSCOS';

/**
 * `CONTAINS` gana siempre sobre `TRACES` al unir ramas del grafo: si una salsa
 * lleva trazas de gluten y el pan del plato contiene gluten, el plato contiene
 * gluten.
 */
export type AllergenPresenceLevel = 'CONTAINS' | 'TRACES';

export interface AllergenPresence {
  readonly code: AllergenCode;
  readonly level: AllergenPresenceLevel;
}

/**
 * La triple unidad de un item.
 *
 * Compra y stock son **niveles de empaquetado**, no unidades fisicas: sus
 * etiquetas son libres ("caja", "botella", "bandeja") y lo que importa son los
 * dos factores. Solo la unidad de uso es fisica, y es donde entra el analisis
 * dimensional.
 *
 * Ejemplo: caja de 6 botellas de 700 ml de aceite.
 *   purchaseUnitLabel: 'caja', stockUnitLabel: 'botella', usageUnit: 'ml',
 *   purchaseToStock: 6, stockToUsage: 700
 *   -> una caja rinde 4200 ml.
 */
export interface ItemUnits {
  readonly purchaseUnitLabel: string;
  readonly stockUnitLabel: string;
  readonly usageUnit: Unit;
  /** Unidades de stock que contiene una unidad de compra. */
  readonly purchaseToStock: Decimal;
  /** Unidades de uso que contiene una unidad de stock. */
  readonly stockToUsage: Decimal;
  /** Puente MASA <-> VOLUMEN. Gramos que pesa un mililitro. */
  readonly densityGPerMl?: Decimal;
  /** Puente RECUENTO <-> MASA. Gramos que pesa una pieza. */
  readonly weightPerPieceG?: Decimal;
}

export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly ItemKind[];
  readonly units: ItemUnits;
  /** Precio de **una unidad de compra** (una caja entera, no un mililitro). */
  readonly purchasePrice?: Money;
  /**
   * Merma de limpieza o factor de correccion, en (0, 1].
   * Una alcachofa que rinde el 40 % de su peso de compra vale `0.4`.
   */
  readonly cleaningYield: Decimal;
  readonly allergens: readonly AllergenPresence[];
  /** Tipo de IVA aplicable como fraccion: `0.10` para el 10 %. */
  readonly vatRate: Decimal;
}

export type Catalog = ReadonlyMap<string, CatalogItem>;

/**
 * Una linea de receta.
 *
 * `quantity` es **peso NETO**: lo que llega al plato, ya limpio. El motor
 * divide por el factor de correccion para saber cuanto hay que comprar. El
 * cocinero escribe "200 g de alcachofa limpia" y el sistema deduce que hay que
 * sacar 500 g de camara.
 */
export interface RecipeLineInput {
  readonly itemId: string;
  readonly quantity: Quantity;
  /**
   * Sustituye al factor de correccion del item para esta linea concreta.
   * Util cuando una receta usa un despiece distinto del habitual.
   */
  readonly cleaningYieldOverride?: Decimal;
  readonly note?: string;
}

/**
 * Una receta: elaboracion intermedia o plato de venta.
 *
 * `outputQuantity` es la produccion **antes** de aplicar la merma de proceso.
 * Un fondo que parte de 10 L de ingredientes y reduce al 40 % se declara con
 * `outputQuantity = 10 l` y `yieldFactor = 0.4`; su salida real son 4 L y su
 * coste por litro es el de los ingredientes dividido entre esos 4 L.
 *
 * La merma de proceso vive aqui y no en la linea que consume la elaboracion:
 * un solo lugar de verdad. Quien usa el fondo hereda un coste por litro que ya
 * incorpora la reduccion.
 */
export interface RecipeNode {
  readonly itemId: string;
  readonly lines: readonly RecipeLineInput[];
  /** Merma de proceso o rendimiento, en (0, 1]. `1` = sin perdida. */
  readonly yieldFactor: Decimal;
  readonly outputQuantity: Quantity;
  /** Raciones que salen del lote. Debe ser un entero positivo. */
  readonly portions: number;
}

export type RecipeBook = ReadonlyMap<string, RecipeNode>;
