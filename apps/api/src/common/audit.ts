import type { Database } from '../db/client';
import { auditLogs } from '../db/schema';
import type { Principal } from './principal';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN';

/**
 * Deja constancia de un cambio.
 *
 * Se llama **dentro** de la misma transaccion que el cambio, no despues: si la
 * escritura se deshace, la traza tambien. Un registro de auditoria que menciona
 * cambios que nunca ocurrieron es peor que no tener registro.
 */
export async function recordAudit(
  tx: Database,
  params: {
    tenantId: string;
    actorUserId: string | null;
    action: AuditAction;
    entity: string;
    entityId?: string | null;
    diff?: unknown;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: params.tenantId,
    actorUserId: params.actorUserId,
    action: params.action,
    entity: params.entity,
    entityId: params.entityId ?? null,
    diff: params.diff === undefined ? null : (params.diff as object),
  });
}

/** Version corta para los casos en que ya se tiene el `Principal`. */
export async function recordAuditFor(
  tx: Database,
  principal: Principal,
  action: AuditAction,
  entity: string,
  entityId: string | null,
  diff?: unknown,
): Promise<void> {
  await recordAudit(tx, {
    tenantId: principal.tenantId,
    actorUserId: principal.userId,
    action,
    entity,
    entityId,
    diff,
  });
}
