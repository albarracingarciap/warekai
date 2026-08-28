# Warekai — Andamiaje + módulo de catálogo y escandallos

## Contexto

El repositorio está vacío (solo `README.md` y el commit inicial). Se parte de cero para
construir la base de una aplicación de gestión de cocina profesional para un grupo con
dos establecimientos, más el primer módulo vertical completo: catálogo de ítems y
escandallos con cálculo de costes.

El valor real de esta iteración no está en las pantallas sino en `packages/domain`: un
motor de costes puro que resuelve triple unidad, doble merma y elaboraciones anidadas.
Si ese motor está mal, todo lo que se construya encima está mal, y el error se descubre
meses después en el margen. Por eso se construye y se deja verde antes de tocar la base
de datos.

El resto de módulos (inventario, compras, producción, mermas, APPCC, analítica) quedan
solo como estructura de carpetas vacía.

### Decisiones de dominio confirmadas

1. **`recipe_line.quantity` es peso NETO.** El cocinero escribe "200 g de alcachofa
   limpia"; el motor divide por el factor de corrección para obtener lo que hay que
   comprar. `200 / 0,40 = 500 g` a coste de compra.
2. **La merma de proceso vive en la elaboración, no en la línea.** Una elaboración
   declara `yieldFactor`; su coste unitario de salida es el coste de entradas dividido
   por el rendimiento. Quien la consume hereda ese coste ya reducido. Un solo lugar de
   verdad.
3. **El food cost se calcula sobre PVP sin IVA.** `foodCost% = coste / pvpNeto`. El
   ítem guarda su `vatRate` y el motor devuelve también el PVP con IVA para carta.

### Requisito previo del entorno

`pnpm` y `docker` no están instalados en esta máquina (`npm 9.9.3` y `node v24.11.1` sí).
El primer paso de la ejecución será `npm i -g pnpm` y verificar Docker Desktop. Si Docker
no puede instalarse, el README documentará la alternativa de un PostgreSQL local, pero el
`docker-compose.yml` se entrega igualmente.

---

## Estructura de ficheros

```
warekai/
├── package.json                  workspaces, scripts raíz
├── pnpm-workspace.yaml
├── turbo.json                    orquestación build/test/lint
├── docker-compose.yml            postgres:16 + redis:7
├── .env.example
├── eslint.config.js              flat config, no-explicit-any en error
├── .prettierrc
├── .husky/pre-commit             lint-staged + test del paquete domain
├── README.md                     arranque desde cero + decisiones técnicas
│
├── packages/
│   ├── domain/                   ← EL NÚCLEO. TS puro, dep. única: decimal.js
│   │   ├── src/
│   │   │   ├── money.ts          Money: entero en céntimos + Decimal interno
│   │   │   ├── quantity.ts       Quantity, Unit, dimensiones
│   │   │   ├── conversion.ts     triple unidad, densidad, peso/pieza
│   │   │   ├── yield.ts          merma limpieza + merma proceso
│   │   │   ├── graph.ts          DAG, orden topológico, detección de ciclos
│   │   │   ├── explode.ts        explosión recursiva de elaboraciones
│   │   │   ├── costing.ts        coste total, ración, food cost, margen
│   │   │   ├── pricing.ts        cálculo inverso de PVP
│   │   │   ├── scaling.ts        escalado a N raciones
│   │   │   ├── allergens.ts      propagación hacia arriba
│   │   │   ├── errors.ts         jerarquía de errores del dominio
│   │   │   └── index.ts
│   │   └── src/**/*.test.ts      cobertura 100 % (thresholds en vitest.config)
│   │
│   ├── contracts/                Zod + tipos derivados, compartidos web↔api
│   │   └── src/{item,recipe,auth,costing,common}.ts
│   │
│   └── ui/                       componentes + tokens de diseño
│       └── src/{tokens,primitives,patterns}/
│
├── apps/
│   ├── api/                      NestJS
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/         JWT + refresh + PIN por dispositivo
│   │   │   │   ├── catalog/      items, familias, alérgenos
│   │   │   │   ├── recipes/      recetas, líneas, versionado
│   │   │   │   ├── costing/      orquesta packages/domain
│   │   │   │   ├── jobs/         BullMQ: recálculo en cascada
│   │   │   │   ├── inventory/    VACÍO (solo carpeta)
│   │   │   │   ├── purchasing/   VACÍO
│   │   │   │   ├── production/   VACÍO
│   │   │   │   ├── waste/        VACÍO
│   │   │   │   ├── haccp/        VACÍO
│   │   │   │   └── analytics/    VACÍO
│   │   │   ├── db/               schema Drizzle, migraciones, RLS, seed
│   │   │   └── common/           guards, tenant context, audit interceptor
│   │   └── drizzle.config.ts
│   │
│   └── web/                      React 18 + Vite + PWA
│       └── src/
│           ├── data/             ← PUNTO DE EXTENSIÓN OFFLINE
│           ├── features/{auth,catalog,recipes,dashboard}/
│           ├── app/              router, providers, layouts
│           └── styles/
```

---

## Modelo de datos (Drizzle + PostgreSQL 16)

Todas las tablas de negocio llevan `tenant_id uuid not null` y RLS activada desde la
primera migración. El acceso pasa siempre por una transacción que hace
`SET LOCAL app.tenant_id = $1`; un helper `withTenant(tenantId, fn)` en `db/tenant.ts`
es el único camino de acceso, y un test de integración verifica que una consulta sin
contexto de tenant devuelve cero filas.

**Multi-tenant y organización**

- `tenant` — id, nombre, moneda, tipo de IVA por defecto
- `establishment` — tenant_id, nombre, código
- `warehouse` — establishment_id, nombre, tipo

**Catálogo**

- `item_family` — jerarquía con `parent_id` autorreferencial y `path` materializado
- `item` — el modelo único. `type: 'RAW' | 'PREP' | 'SALE'` como array de flags
  (`isRaw`, `isPrep`, `isSale`) porque una bebida es materia prima **y** artículo de
  venta a la vez. Campos de unidad: `purchaseUnit`, `stockUnit`, `usageUnit`,
  `purchaseToStockFactor`, `stockToUsageFactor`, `densityGPerMl`, `weightPerPieceG`,
  `cleaningYield` (factor de corrección), `lastPurchasePriceCents`, `vatRate`
- `allergen` — los 14 del Reglamento UE 1169/2011, en castellano
- `item_allergen` — con `presence: 'CONTAINS' | 'TRACES'`

**Recetario**

- `recipe` — item_id (la elaboración o plato que produce), `versionNo`,
  `validFrom` / `validTo` para versionado por vigencia, `yieldFactor` (merma de
  proceso), `outputQuantity`, `outputUnit`, `portions`
- `recipe_line` — recipe_id, item_id (referencia a MP o a otra elaboración),
  `quantity` (NETO), `unit`, `cleaningYieldOverride` (nullable, por si esta receta
  limpia distinto), `sortOrder`
- `cost_snapshot` — recipe_id, versión, `totalCostCents`, `costPerPortionCents`,
  `foodCostPct`, `calculatedAt`, `breakdown` jsonb con el desglose completo

**Seguridad y auditoría**

- `user`, `role`, `permission`, `user_role` (con ámbito por establecimiento),
  `trusted_device` (para el PIN), `refresh_token`
- `audit_log` — actor, acción, tabla, registro, diff jsonb, timestamp

**Restricción de integridad clave:** un trigger en `recipe_line` que rechaza la
inserción si crea un ciclo en el grafo, además de la comprobación en el dominio.
La defensa está en los dos sitios porque el coste de un ciclo en producción es un
recálculo que no termina nunca.

---

## Firmas del motor de costes

```ts
// money.ts — nunca coma flotante
export class Money {
  static fromCents(cents: number): Money;
  static fromEuros(euros: string): Money; // string, no number
  static zero(): Money;
  add(o: Money): Money;
  subtract(o: Money): Money;
  multiply(factor: Decimal | string): Money;
  divide(divisor: Decimal | string): Money; // lanza DivisionByZeroError
  allocate(ratios: Decimal[]): Money[]; // reparte sin perder céntimos
  get cents(): number;
  toString(): string;
}

// conversion.ts
export type Dimension = 'MASS' | 'VOLUME' | 'COUNT';
export interface ItemUnits {
  purchaseUnit: Unit;
  stockUnit: Unit;
  usageUnit: Unit;
  purchaseToStock: Decimal; // 6 botellas por caja
  stockToUsage: Decimal; // 700 ml por botella
  densityGPerMl?: Decimal; // puente MASS <-> VOLUME
  weightPerPieceG?: Decimal; // puente COUNT <-> MASS
}
export function convert(qty: Quantity, to: Unit, units: ItemUnits): Quantity;
// lanza IncompatibleUnitsError si falta el puente necesario

export function costPerUsageUnit(purchasePrice: Money, packSize: Quantity, units: ItemUnits): Money;

// yield.ts
export function grossFromNet(net: Quantity, cleaningYield: Decimal): Quantity;
// 200 g netos / 0,40 = 500 g brutos.  yield <= 0 o > 1 -> InvalidYieldError

export function outputCostPerUnit(
  inputCost: Money,
  outputQty: Quantity,
  yieldFactor: Decimal,
): Money;
// coste de entradas / (cantidad de salida) ya afectada por el rendimiento

// graph.ts
export interface RecipeNode {
  itemId: string;
  lines: RecipeLineInput[];
  yieldFactor: Decimal;
  outputQuantity: Quantity;
  portions: number;
}
export function topologicalOrder(nodes: Map<string, RecipeNode>): string[];
// lanza CyclicRecipeError con la ruta completa del ciclo: A -> B -> C -> A

// explode.ts
export interface ExplodedLine {
  itemId: string;
  path: string[];
  depth: number;
  netQuantity: Quantity;
  grossQuantity: Quantity;
  unitCost: Money;
  lineCost: Money;
}
export function explodeRecipe(
  rootItemId: string,
  catalog: Catalog,
  recipes: Map<string, RecipeNode>,
): ExplodedLine[]; // recursiva sin límite de profundidad, memoizada

// costing.ts
export interface CostBreakdown {
  totalCost: Money;
  costPerPortion: Money;
  lines: ExplodedLine[];
  portions: number;
}
export function calculateRecipeCost(
  rootItemId: string,
  catalog: Catalog,
  recipes: Map<string, RecipeNode>,
): CostBreakdown;

export function foodCostPercentage(cost: Money, netPvp: Money): Decimal;
export function grossMargin(cost: Money, netPvp: Money): Money;

// pricing.ts
export interface PriceSuggestion {
  netPrice: Money;
  vatAmount: Money;
  grossPrice: Money;
  roundedGrossPrice: Money;
  effectiveFoodCost: Decimal;
}
export function priceForTargetFoodCost(
  costPerPortion: Money,
  targetFoodCost: Decimal,
  vatRate: Decimal,
  rounding?: RoundingStrategy, // por defecto: a 0,50 € hacia arriba
): PriceSuggestion;

// scaling.ts
export function scaleRecipe(node: RecipeNode, targetPortions: number): RecipeNode;

// allergens.ts
export function propagateAllergens(
  rootItemId: string,
  catalog: Catalog,
  recipes: Map<string, RecipeNode>,
): AllergenPresence[]; // CONTAINS gana sobre TRACES al unir ramas
```

**Caso de prueba obligatorio** (el del enunciado, verificado a mano en el test):
alcachofa con factor de corrección 0,40, dentro de un fondo con rendimiento 0,40,
dentro de una salsa, dentro de un plato de 3 raciones. El test comprueba el coste
por ración céntimo a céntimo, no con `toBeCloseTo`.

---

## Sistema de diseño

Tres contextos reales, no un único diseño estrechado. Tokens propios en
`packages/ui/src/tokens`, consumidos por Tailwind vía CSS custom properties.

- **Paleta**: base carbón/pizarra oscura con acentos de alta saturación. Contraste
  mínimo 7:1 en texto principal — la cocina tiene zonas mal iluminadas y zonas con
  reflejo, y AA no basta ahí aunque sea el mínimo exigido.
- **Escala tipográfica**: dos escalas paralelas. `desk-*` densa para oficina,
  `station-*` con paso ~1,4× para tableta, legible a un metro.
- **Áreas táctiles**: 44 px en escritorio, 64 px en el modo partida, con confirmación
  en dos tiempos para acciones destructivas — un guante roza la pantalla sin querer.
- **Densidad**: la tabla de catálogo en escritorio muestra ~25 filas sin scroll, con
  navegación por teclado y edición en celda.

Sin librerías de gráficas: el cuadro de mando usa tres tarjetas numéricas y una lista
ordenada de platos por encima del objetivo. Es lo que se necesita y no justifica una
dependencia.

---

## Punto de extensión offline

`apps/web/src/data/` abstrae todo el acceso a datos tras una interfaz. Los componentes
nunca llaman a `fetch` ni conocen las URLs.

```
data/
├── ports.ts        interfaces CatalogPort, RecipePort, CostingPort
├── http/           implementación actual: fetch + tipos de contracts
├── queries/        hooks de TanStack Query construidos sobre los ports
└── OFFLINE.md      documenta la extensión prevista
```

La cola offline se insertará como un decorador sobre los ports (escribe en IndexedDB,
encola la mutación, resuelve optimista) sin tocar un solo componente. `OFFLINE.md`
documenta el contrato: qué operaciones son encolables, cómo se resuelven los conflictos
por `updatedAt`, y qué queries deben marcarse como `staleTime: Infinity` en modo avión.

---

## Orden de ejecución y commits

Commits pequeños y descriptivos, en este orden estricto:

1. `chore: monorepo pnpm + tooling` — workspaces, turbo, eslint, prettier, husky,
   docker-compose, .env.example tipado con Zod
2. `feat(domain): aritmética decimal y unidades` — Money, Quantity, conversión
3. `feat(domain): mermas de limpieza y proceso` — con sus tests
4. `feat(domain): grafo, ciclos y explosión recursiva`
5. `feat(domain): costes, food cost, PVP inverso, escalado, alérgenos`
6. `test(domain): cobertura 100 % con casos reales de cocina`
   — **puerta de calidad: el paquete debe estar verde y al 100 % antes de seguir**
7. `feat(contracts): esquemas Zod compartidos`
8. `feat(api): schema Drizzle, migraciones y RLS`
9. `feat(api): seeder con 40 materias primas, 5 elaboraciones, 8 platos`
10. `feat(api): autenticación JWT, refresh y PIN por dispositivo`
11. `feat(api): CRUD de catálogo y recetas con control de acceso en servicio`
12. `feat(api): cálculo de escandallo y recálculo en cascada con BullMQ`
13. `feat(ui): tokens de diseño y primitivas`
14. `feat(web): andamiaje Vite, PWA, router, capa de datos`
15. `feat(web): autenticación y selector de establecimiento`
16. `feat(web): catálogo — listado y ficha con unidades`
17. `feat(web): editor de escandallo con coste en vivo`
18. `feat(web): ficha técnica para tableta y cuadro de mando`
19. `docs: README con arranque y decisiones técnicas`

---

## Verificación

**Paquete domain** (la que más importa):

```bash
pnpm --filter @warekai/domain test -- --coverage
```

Debe dar 100 % en statements, branches, functions y lines; los thresholds están en
`vitest.config.ts`, así que por debajo de eso el comando falla. Incluye un test que
importa el paquete en Node sin base de datos ni variables de entorno, para probar
que no arrastra infraestructura.

**Base de datos y RLS:**

```bash
docker compose up -d
pnpm --filter @warekai/api db:migrate
pnpm --filter @warekai/api db:seed
pnpm --filter @warekai/api test:integration
```

El test de integración crea dos tenants, siembra datos en ambos y verifica que una
consulta con el contexto del tenant A no ve ni una fila del tenant B.

**API:** `pnpm dev:api`, luego OpenAPI en `http://localhost:3000/docs`. Comprobación
manual del escandallo del plato con alcachofa: el coste por ración que devuelve
`GET /recipes/:id/costing` debe coincidir con el del test unitario del dominio.

**Frontend:** `pnpm dev:web`. Recorrido: login → seleccionar establecimiento →
catálogo → abrir un ítem y cambiar su precio de compra → volver al escandallo y
comprobar que el coste se ha propagado. Lighthouse para verificar PWA instalable
y contraste; navegación completa del editor de escandallo solo con teclado.
