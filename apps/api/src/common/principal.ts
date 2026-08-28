import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { hasPermission, type Permission, type RoleAssignmentDto } from '@warekai/contracts';
import type { Request } from 'express';

/**
 * Quien hace la peticion y desde donde.
 *
 * `establishmentId` sale del selector de establecimiento del frontend (cabecera
 * `X-Warekai-Establishment`) o viene fijado por el dispositivo cuando la sesion
 * se abrio con PIN. Es la pieza que acota los permisos: un jefe de cocina manda
 * en su local y no en el otro.
 */
export interface Principal {
  readonly userId: string;
  readonly tenantId: string;
  readonly displayName: string;
  readonly establishmentId: string | null;
  readonly roles: readonly RoleAssignmentDto[];
  /** Sesion abierta con PIN en un dispositivo de confianza. */
  readonly isPinSession: boolean;
}

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

/** Inyecta el `Principal` en el argumento del controlador. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'La peticion no tiene sesion asociada.',
      });
    }
    return request.principal;
  },
);

/**
 * Comprobacion de permisos.
 *
 * Se invoca desde los **servicios**, no desde los controladores ni desde la
 * interfaz. Ocultar un boton no es una medida de seguridad, y un guard en el
 * controlador se olvida en cuanto alguien anade un metodo nuevo o llama al
 * servicio desde un trabajo en cola. Poniendola en el servicio, el camino a los
 * datos pasa siempre por aqui.
 */
export function assertPermission(principal: Principal, permission: Permission): void {
  if (!hasPermission(principal.roles, principal.establishmentId, permission)) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: `No tienes permiso para "${permission}" en este establecimiento.`,
    });
  }
}

/**
 * Las sesiones abiertas con PIN no tocan precios.
 *
 * El PIN vive en una tablet compartida en la partida. Sirve para consultar una
 * ficha tecnica en mitad del servicio, no para cambiar lo que cuesta un plato.
 */
export function assertNotPinSession(principal: Principal, action: string): void {
  if (principal.isPinSession) {
    throw new ForbiddenException({
      code: 'PIN_SESSION_FORBIDDEN',
      message: `Una sesion abierta con PIN no puede ${action}. Entra con usuario y contrasena.`,
    });
  }
}
