import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client';

async function main(): Promise<void> {
  console.log('Aplicando migraciones...');
  await migrate(getDb(), { migrationsFolder: join(__dirname, 'migrations') });
  console.log('Migraciones al dia.');
}

main()
  .catch((error: unknown) => {
    console.error('Fallo al migrar:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
