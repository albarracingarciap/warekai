import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest, Principal } from '../../common/principal';
import { TokenService } from './token.service';

export const IS_PUBLIC = 'warekai:public';

/** Marca un endpoint como accesible sin sesion (login, refresco, salud). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Cabecera del selector de establecimiento del frontend. */
export const ESTABLISHMENT_HEADER = 'x-warekai-establishment';
export const TENANT_HEADER = 'x-warekai-tenant';

/**
 * Autenticacion. Solo eso.
 *
 * El guard comprueba **quien** eres y en que establecimiento estas trabajando.
 * **Que** puedes hacer lo decide cada servicio con `assertPermission`, porque
 * un guard de controlador se olvida en cuanto alguien anade un metodo o llama
 * al servicio desde un trabajo en cola.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'MISSING_TOKEN',
        message: 'Falta la cabecera de autorizacion.',
      });
    }

    const payload = await this.tokens.verifyAccessToken(header.slice('Bearer '.length));

    const requested = request.headers[ESTABLISHMENT_HEADER];
    const requestedId = Array.isArray(requested) ? requested[0] : requested;

    let establishmentId = payload.est;
    if (requestedId) {
      if (payload.pin) {
        // La tablet de una partida no cambia de local a mitad de servicio.
        throw new ForbiddenException({
          code: 'PIN_SESSION_FIXED_ESTABLISHMENT',
          message: 'Una sesion de PIN esta atada al establecimiento de su dispositivo.',
        });
      }
      if (!payload.ests.includes(requestedId)) {
        throw new ForbiddenException({
          code: 'ESTABLISHMENT_FORBIDDEN',
          message: 'No tienes acceso a ese establecimiento.',
        });
      }
      establishmentId = requestedId;
    }

    const principal: Principal = {
      userId: payload.sub,
      tenantId: payload.tid,
      displayName: payload.name,
      establishmentId,
      roles: payload.roles,
      isPinSession: payload.pin,
    };
    request.principal = principal;
    return true;
  }
}
