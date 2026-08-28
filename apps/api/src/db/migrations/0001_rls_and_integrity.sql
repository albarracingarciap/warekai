-- Seguridad a nivel de fila e integridad del grafo de elaboraciones.
--
-- Se activa desde el primer dia aunque hoy solo haya un cliente. Introducir
-- multi-tenencia con datos en produccion obliga a revisar cada consulta del
-- sistema y a confiar en que no se ha olvidado ninguna. Aqui la garantiza el
-- motor de base de datos: una consulta sin contexto de tenant devuelve cero
-- filas, no las filas de otro.

--> statement-breakpoint
-- Clave ajena que faltaba: la jerarquia de familias es autorreferencial y
-- Drizzle no la genera para evitar una dependencia circular en el esquema.
ALTER TABLE "item_family"
  ADD CONSTRAINT "item_family_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "item_family"("id") ON DELETE SET NULL;

--> statement-breakpoint
-- Una familia no puede ser su propia madre.
ALTER TABLE "item_family"
  ADD CONSTRAINT "item_family_no_self_parent" CHECK ("parent_id" IS DISTINCT FROM "id");

--> statement-breakpoint
-- Las mermas van en el rango (0, 1]. La comprobacion se repite en el motor, en
-- el contrato Zod y aqui: es el error mas caro del dominio y el unico sitio
-- donde no puede colarse es la base de datos.
ALTER TABLE "item"
  ADD CONSTRAINT "item_cleaning_yield_range" CHECK ("cleaning_yield" > 0 AND "cleaning_yield" <= 1);

--> statement-breakpoint
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_yield_factor_range" CHECK ("yield_factor" > 0 AND "yield_factor" <= 1);

--> statement-breakpoint
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_output_positive" CHECK ("output_quantity" > 0);

--> statement-breakpoint
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_portions_positive" CHECK ("portions" > 0);

--> statement-breakpoint
ALTER TABLE "recipe_line"
  ADD CONSTRAINT "recipe_line_quantity_positive" CHECK ("quantity" > 0);

--> statement-breakpoint
ALTER TABLE "recipe_line"
  ADD CONSTRAINT "recipe_line_yield_range" CHECK (
    "cleaning_yield_override" IS NULL
    OR ("cleaning_yield_override" > 0 AND "cleaning_yield_override" <= 1)
  );

--> statement-breakpoint
-- Una sola version vigente por item. El indice parcial lo garantiza sin
-- impedir que convivan versiones historicas cerradas.
CREATE UNIQUE INDEX "recipe_one_current_version_per_item"
  ON "recipe" ("item_id") WHERE "valid_to" IS NULL;

--> statement-breakpoint
-- Deteccion de ciclos, directos e indirectos.
--
-- El motor de costes ya los detecta y devuelve la ruta completa, que es lo
-- unico util para arreglarlos. Este disparador es la segunda linea: cubre
-- cualquier escritura que no pase por la capa de servicio -- una carga masiva,
-- una correccion manual en produccion, un script de migracion de datos. Un
-- ciclo que llega a la tabla convierte el recalculo en cascada en un proceso
-- que no termina nunca.
CREATE OR REPLACE FUNCTION warekai_check_recipe_cycle() RETURNS trigger AS $$
DECLARE
  producing_item uuid;
  cycle_path uuid[];
BEGIN
  SELECT r.item_id INTO producing_item FROM recipe r WHERE r.id = NEW.recipe_id;

  IF producing_item = NEW.item_id THEN
    RAISE EXCEPTION 'Ciclo en las elaboraciones: % se contiene a si misma', producing_item
      USING ERRCODE = 'check_violation';
  END IF;

  -- Recorrido hacia abajo desde el item que se acaba de anadir. Si en algun
  -- punto se vuelve a llegar al item que produce esta receta, hay ciclo.
  WITH RECURSIVE descendants(item_id, path) AS (
    SELECT NEW.item_id, ARRAY[NEW.item_id]
    UNION ALL
    SELECT rl.item_id, d.path || rl.item_id
    FROM descendants d
    JOIN recipe r ON r.item_id = d.item_id AND r.valid_to IS NULL
    JOIN recipe_line rl ON rl.recipe_id = r.id
    WHERE NOT rl.item_id = ANY(d.path)
  )
  SELECT path INTO cycle_path FROM descendants WHERE item_id = producing_item LIMIT 1;

  IF cycle_path IS NOT NULL THEN
    RAISE EXCEPTION 'Ciclo en las elaboraciones anidadas: %', cycle_path
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
CREATE TRIGGER recipe_line_cycle_check
  BEFORE INSERT OR UPDATE OF item_id, recipe_id ON "recipe_line"
  FOR EACH ROW EXECUTE FUNCTION warekai_check_recipe_cycle();

--> statement-breakpoint
-- Seguridad a nivel de fila.
--
-- `FORCE` es imprescindible: Postgres NO aplica las politicas al propietario de
-- la tabla salvo que se le obligue. En desarrollo la aplicacion se conecta con
-- el mismo rol que creo el esquema, asi que sin `FORCE` la politica existiria y
-- no filtraria nada. El aislamiento pareceria funcionar hasta el dia que no.
--
-- `tenant`, `allergen`, `role` y `permission` quedan fuera a proposito: son
-- catalogos raiz. `tenant` tiene que poder leerse antes de saber cual es el
-- tenant, durante el login, y sus filas solo contienen un nombre y un slug.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'establishment', 'warehouse', 'user', 'user_role', 'trusted_device',
    'refresh_token', 'item_family', 'item', 'item_allergen', 'recipe',
    'recipe_line', 'cost_snapshot', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END;
$$;

-- Sin contexto de tenant, `current_setting('app.tenant_id', true)` devuelve
-- NULL y la comparacion tambien: ninguna fila pasa el filtro. Es el
-- comportamiento que se quiere -- fallar cerrado -- y lo comprueba el test de
-- integracion `rls.integration.test.ts`.
