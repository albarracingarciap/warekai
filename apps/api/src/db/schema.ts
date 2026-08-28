import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema de datos de Warekai.
 *
 * Dos decisiones estructurales que atraviesan todo el fichero:
 *
 * 1. **`tenant_id` en toda tabla de negocio, desde el primer dia.** Hoy hay un
 *    solo cliente con dos establecimientos. Introducir multi-tenencia despues,
 *    con datos en produccion, obliga a reescribir cada consulta y cada indice.
 *    La seguridad a nivel de fila se activa en la migracion `0001_rls`.
 *
 * 2. **Decimales en `numeric`, dinero en `integer` de centimos.** Drizzle
 *    devuelve `numeric` como cadena, que es exactamente lo que necesita el
 *    motor de costes para reconstruir un Decimal sin pasar por coma flotante.
 */

// --- Enumerados ---------------------------------------------------------------

export const unitEnum = pgEnum('unit', ['g', 'kg', 'ml', 'cl', 'l', 'ud']);
export const itemKindEnum = pgEnum('item_kind', ['RAW', 'PREP', 'SALE']);
export const allergenLevelEnum = pgEnum('allergen_level', ['CONTAINS', 'TRACES']);
export const roleEnum = pgEnum('role_name', ['ADMIN', 'CHEF', 'COCINERO', 'OFICINA']);
export const warehouseKindEnum = pgEnum('warehouse_kind', [
  'CAMARA',
  'CONGELADOR',
  'SECO',
  'BARRA',
  'ECONOMATO',
]);
export const auditActionEnum = pgEnum('audit_action', ['CREATE', 'UPDATE', 'DELETE', 'LOGIN']);

const now = sql`now()`;

/** Columnas comunes de auditoria ligera. */
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
};

// --- Organizacion --------------------------------------------------------------

export const tenants = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Identificador legible con el que el login resuelve el tenant antes de
   * poder consultar `user`. Ver `TenantResolver` y la nota sobre RLS en
   * `db/tenant.ts`.
   */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('EUR'),
  /** IVA por defecto de restauracion en Espana. */
  defaultVatRate: numeric('default_vat_rate', { precision: 6, scale: 4 }).notNull().default('0.10'),
  /** Food cost objetivo del grupo, sobre PVP sin IVA. */
  targetFoodCost: numeric('target_food_cost', { precision: 6, scale: 4 }).notNull().default('0.30'),
  ...timestamps,
});

export const establishments = pgTable(
  'establishment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    ...timestamps,
  },
  (table) => [unique('establishment_tenant_code_uq').on(table.tenantId, table.code)],
);

export const warehouses = pgTable(
  'warehouse',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    establishmentId: uuid('establishment_id')
      .notNull()
      .references(() => establishments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: warehouseKindEnum('kind').notNull().default('SECO'),
    ...timestamps,
  },
  (table) => [index('warehouse_establishment_idx').on(table.establishmentId)],
);

// --- Usuarios, roles y permisos -------------------------------------------------

export const users = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    /** Hash del PIN corto de cocina. Nulo si el usuario no lo tiene configurado. */
    pinHash: text('pin_hash'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [unique('user_tenant_email_uq').on(table.tenantId, table.email)],
);

/**
 * Catalogo de roles. Es tabla y no solo enumerado para poder describirlos en la
 * interfaz de administracion sin duplicar los textos en el frontend.
 */
export const roles = pgTable('role', {
  name: roleEnum('name').primaryKey(),
  description: text('description').notNull(),
});

/**
 * Permisos concedidos por cada rol. Sembrada desde la matriz de
 * `@warekai/contracts`, que es la fuente unica.
 */
export const permissions = pgTable(
  'permission',
  {
    role: roleEnum('role').notNull(),
    permission: text('permission').notNull(),
  },
  (table) => [primaryKey({ columns: [table.role, table.permission] })],
);

/**
 * Rol de un usuario, acotado a un establecimiento.
 * `establishment_id` nulo significa que el rol aplica a todo el tenant.
 */
export const userRoles = pgTable(
  'user_role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    establishmentId: uuid('establishment_id').references(() => establishments.id, {
      onDelete: 'cascade',
    }),
    ...timestamps,
  },
  (table) => [index('user_role_user_idx').on(table.userId)],
);

/**
 * Dispositivo de confianza para el acceso por PIN.
 *
 * El token del dispositivo se guarda solo como hash: si alguien lee la tabla,
 * no puede suplantar la tablet. Se entrega una unica vez, al darlo de alta.
 */
export const trustedDevices = pgTable(
  'trusted_device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    establishmentId: uuid('establishment_id')
      .notNull()
      .references(() => establishments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('trusted_device_token_idx').on(table.tokenHash)],
);

export const refreshTokens = pgTable(
  'refresh_token',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('refresh_token_user_idx').on(table.userId)],
);

// --- Catalogo ------------------------------------------------------------------

/**
 * Familias con jerarquia. `path` guarda la ruta materializada de nombres para
 * poder mostrar "Verduras > Hoja" en una tabla densa sin recorrer el arbol en
 * cada fila.
 */
export const itemFamilies = pgTable(
  'item_family',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    path: text('path')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    ...timestamps,
  },
  (table) => [index('item_family_parent_idx').on(table.parentId)],
);

/**
 * El item, modelo unico del catalogo.
 *
 * `kinds` es un array y no un enumerado excluyente: una botella de vino es a la
 * vez materia prima (entra en una salsa) y articulo de venta (se sirve por
 * copas). Tres entidades separadas obligarian a duplicarla y a mantener dos
 * precios de compra sincronizados.
 *
 * Compra y stock son niveles de empaquetado con etiqueta libre; solo
 * `usage_unit` es una unidad fisica. `density_g_per_ml` y `weight_per_piece_g`
 * son los puentes entre dimensiones: sin ellos el sistema no resuelve "media
 * cebolla" ni "un chorro de aceite".
 */
export const items = pgTable(
  'item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').references(() => itemFamilies.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kinds: itemKindEnum('kinds').array().notNull(),

    purchaseUnitLabel: text('purchase_unit_label').notNull(),
    stockUnitLabel: text('stock_unit_label').notNull(),
    usageUnit: unitEnum('usage_unit').notNull(),
    purchaseToStock: numeric('purchase_to_stock', { precision: 18, scale: 6 }).notNull(),
    stockToUsage: numeric('stock_to_usage', { precision: 18, scale: 6 }).notNull(),
    densityGPerMl: numeric('density_g_per_ml', { precision: 12, scale: 6 }),
    weightPerPieceG: numeric('weight_per_piece_g', { precision: 12, scale: 4 }),

    /** Precio de UNA unidad de compra, en centimos. */
    purchasePriceCents: integer('purchase_price_cents'),
    /** Merma de limpieza o factor de correccion, en (0, 1]. */
    cleaningYield: numeric('cleaning_yield', { precision: 6, scale: 4 }).notNull().default('1'),
    vatRate: numeric('vat_rate', { precision: 6, scale: 4 }).notNull().default('0.10'),

    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique('item_tenant_code_uq').on(table.tenantId, table.code),
    index('item_tenant_name_idx').on(table.tenantId, table.name),
    index('item_family_idx').on(table.familyId),
  ],
);

/** Los 14 alergenos del Reglamento UE 1169/2011. Referencia comun, sin tenant. */
export const allergens = pgTable('allergen', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const itemAllergens = pgTable(
  'item_allergen',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    allergenCode: text('allergen_code')
      .notNull()
      .references(() => allergens.code, { onDelete: 'cascade' }),
    level: allergenLevelEnum('level').notNull().default('CONTAINS'),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.allergenCode] })],
);

// --- Recetario ------------------------------------------------------------------

/**
 * Receta con versionado por vigencia.
 *
 * Una receta nunca se sobrescribe cuando cambia de forma significativa: se
 * cierra la vigente poniendo `valid_to` y se abre una version nueva. Un
 * escandallo firmado hace seis meses debe poder reconstruirse tal como era,
 * porque es la base de una decision de precio que ya se tomo.
 *
 * `output_quantity` es la produccion **antes** de la merma de proceso. Un fondo
 * que parte de 10 l y reduce al 40 % se declara con 10 l y `yield_factor` 0.4;
 * su salida real son 4 l.
 */
export const recipes = pgTable(
  'recipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull().default(1),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().default(now),
    validTo: timestamp('valid_to', { withTimezone: true }),

    /** Merma de proceso o rendimiento del lote, en (0, 1]. */
    yieldFactor: numeric('yield_factor', { precision: 6, scale: 4 }).notNull().default('1'),
    outputQuantity: numeric('output_quantity', { precision: 18, scale: 6 }).notNull(),
    outputUnit: unitEnum('output_unit').notNull(),
    portions: integer('portions').notNull().default(1),

    /** PVP de carta con IVA, en centimos. Nulo si el item no se vende. */
    listPriceCents: integer('list_price_cents'),
    method: text('method'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    index('recipe_item_idx').on(table.itemId),
    index('recipe_tenant_valid_idx').on(table.tenantId, table.validTo),
  ],
);

export const recipeLines = pgTable(
  'recipe_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),

    /** Cantidad NETA: lo que llega al plato, ya limpio. */
    quantity: numeric('quantity', { precision: 18, scale: 6 }).notNull(),
    unit: unitEnum('unit').notNull(),
    /** Sustituye al factor de correccion del item solo en esta linea. */
    cleaningYieldOverride: numeric('cleaning_yield_override', { precision: 6, scale: 4 }),
    note: text('note'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('recipe_line_recipe_idx').on(table.recipeId),
    index('recipe_line_item_idx').on(table.itemId),
  ],
);

/**
 * Coste congelado en un momento dado.
 *
 * `breakdown` guarda el escandallo explotado completo en JSON. Ocupa mas, pero
 * permite responder "por que costaba esto en marzo" sin reconstruir el estado
 * del catalogo de aquel dia, que es imposible una vez cambiaron los precios.
 */
export const costSnapshots = pgTable(
  'cost_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    recipeVersionNo: integer('recipe_version_no').notNull(),

    totalCostCents: integer('total_cost_cents').notNull(),
    costPerPortionCents: integer('cost_per_portion_cents').notNull(),
    costPerOutputUnitCents: numeric('cost_per_output_unit_cents', {
      precision: 18,
      scale: 6,
    }).notNull(),
    listPriceCents: integer('list_price_cents'),
    foodCostRatio: numeric('food_cost_ratio', { precision: 8, scale: 6 }),
    breakdown: jsonb('breakdown').notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('cost_snapshot_recipe_idx').on(table.recipeId, table.calculatedAt)],
);

// --- Auditoria -------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: auditActionEnum('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    /** Diferencia aplicada, para poder reconstruir el cambio. */
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  },
  (table) => [index('audit_log_entity_idx').on(table.entity, table.entityId, table.createdAt)],
);

// --- Relaciones ------------------------------------------------------------------

export const itemsRelations = relations(items, ({ one, many }) => ({
  family: one(itemFamilies, { fields: [items.familyId], references: [itemFamilies.id] }),
  allergens: many(itemAllergens),
  recipes: many(recipes),
}));

export const itemFamiliesRelations = relations(itemFamilies, ({ one, many }) => ({
  parent: one(itemFamilies, {
    fields: [itemFamilies.parentId],
    references: [itemFamilies.id],
    relationName: 'family_parent',
  }),
  children: many(itemFamilies, { relationName: 'family_parent' }),
  items: many(items),
}));

export const itemAllergensRelations = relations(itemAllergens, ({ one }) => ({
  item: one(items, { fields: [itemAllergens.itemId], references: [items.id] }),
  allergen: one(allergens, {
    fields: [itemAllergens.allergenCode],
    references: [allergens.code],
  }),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  item: one(items, { fields: [recipes.itemId], references: [items.id] }),
  lines: many(recipeLines),
  snapshots: many(costSnapshots),
}));

export const recipeLinesRelations = relations(recipeLines, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeLines.recipeId], references: [recipes.id] }),
  item: one(items, { fields: [recipeLines.itemId], references: [items.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  establishment: one(establishments, {
    fields: [userRoles.establishmentId],
    references: [establishments.id],
  }),
}));

export const schema = {
  tenants,
  establishments,
  warehouses,
  users,
  roles,
  permissions,
  userRoles,
  trustedDevices,
  refreshTokens,
  itemFamilies,
  items,
  allergens,
  itemAllergens,
  recipes,
  recipeLines,
  costSnapshots,
  auditLogs,
  itemsRelations,
  itemFamiliesRelations,
  itemAllergensRelations,
  recipesRelations,
  recipeLinesRelations,
  usersRelations,
  userRolesRelations,
};

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
export type RecipeRow = typeof recipes.$inferSelect;
export type RecipeLineRow = typeof recipeLines.$inferSelect;
export type UserRow = typeof users.$inferSelect;
