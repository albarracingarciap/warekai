import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { Public } from './modules/auth/auth.guard';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Comprobacion de vida y de conexion a base de datos' })
  async check(): Promise<{ status: 'ok' | 'degraded'; database: boolean }> {
    try {
      await getDb().execute(sql`select 1`);
      return { status: 'ok', database: true };
    } catch {
      return { status: 'degraded', database: false };
    }
  }
}
