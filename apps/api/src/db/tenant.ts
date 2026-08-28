import { sql } from 'drizzle-orm';
import { getDb, type Database } from './client';
import { schema } from './schema';

/**
 * Acceso a datos acotado a un tenant.
 *
 * ## Como funciona el aislamiento
 *
 * Todas las tablas de negocio tienen una politica de seguridad a nivel de fila
 * que compara `tenant_id` con `current_setting('app.tenant_id')`. Esta funcion
 * abre una transaccion, fija esa variable con `set_config(..., true)` -- el
 * `true` la hace local a la transaccion, de modo que no se filtra a la
 * siguiente consulta que reutilice la conexion del pool -- y ejecuta el trabajo
 * dentro.
 *
 * ## Por que `FORCE ROW LEVEL SECURITY`
 *
 * Postgres **no** aplica RLS al propietario de la tabla salvo que se fuerce de
 * forma explicita. En desarrollo la aplicacion se conecta con el mismo rol que
 * creo las tablas, asi que sin `FORCE` la politica existiria y no haria
 * absolutamente nada: el aislamiento pareceria funcionar hasta el dia que no.
 * La migracion `0001_rls` lo fuerza en todas las tablas.
 *
 * ## Regla de uso
 *
 * Ningun servicio consulta `getDb()` directamente. Todo pasa por aqui. La
 * unica excepcion documentada es la resolucion del tenant en el login, que
 * necesita leer `tenant` antes de saber cual es -- y por eso `tenant` es una
 * tabla raiz sin RLS, cuyas filas solo contienen un nombre y un slug.
 */
export async function withTenant<T>(
  tenantId: string,
  work: (tx: Database) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return work(tx as unknown as Database);
  });
}

/**
 * Acceso a las tablas raiz que no llevan `tenant_id`: `tenant`, `allergen`,
 * `role` y `permission`. Son catalogos de referencia compartidos.
 *
 * Se expone con un nombre incomodo a proposito, para que aparezca en las
 * revisiones si alguien lo usa donde no debe.
 */
export function rootTables(): Database {
  return getDb();
}

export { schema };
