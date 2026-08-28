import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RoleAssignmentDto } from '@warekai/contracts';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { loadEnv } from '../../config/env';
import type { Database } from '../../db/client';
import { refreshTokens } from '../../db/schema';

export interface AccessTokenPayload {
  sub: string;
  tid: string;
  name: string;
  /** Establecimiento activo. */
  est: string | null;
  /**
   * Establecimientos a los que el usuario tiene acceso. Van en el token para
   * que el guard pueda validar el selector de establecimiento sin una consulta
   * por peticion.
   */
  ests: string[];
  roles: RoleAssignmentDto[];
  pin: boolean;
}

export interface RefreshTokenPayload {
  sub: string;
  tid: string;
  jti: string;
}

/**
 * Emision y verificacion de tokens.
 *
 * El token de refresco se guarda **hasheado**: si alguien se lleva un volcado
 * de la tabla, no puede renovar sesiones ajenas. Y se rota en cada uso, de modo
 * que si un refresco se reutiliza -- senal de que fue robado -- la version
 * antigua ya esta revocada.
 */
@Injectable()
export class TokenService {
  private readonly env = loadEnv();

  constructor(private readonly jwt: JwtService) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueAccessToken(payload: AccessTokenPayload): Promise<{ token: string; ttl: number }> {
    // Una sesion de PIN caduca antes: la tablet se queda encima del pase.
    const expiresIn = payload.pin ? this.env.PIN_ACCESS_TTL : this.env.JWT_ACCESS_TTL;
    const token = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn,
    });
    return { token, ttl: secondsOf(expiresIn) };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Sesion no valida o caducada.',
      });
    }
  }

  /** Emite un refresco nuevo y lo persiste hasheado. */
  async issueRefreshToken(tx: Database, userId: string, tenantId: string): Promise<string> {
    const jti = randomBytes(24).toString('hex');
    const token = await this.jwt.signAsync(
      { sub: userId, tid: tenantId, jti } satisfies RefreshTokenPayload,
      { secret: this.env.JWT_REFRESH_SECRET, expiresIn: this.env.JWT_REFRESH_TTL },
    );

    await tx.insert(refreshTokens).values({
      tenantId,
      userId,
      tokenHash: TokenService.hash(token),
      expiresAt: new Date(Date.now() + secondsOf(this.env.JWT_REFRESH_TTL) * 1000),
    });
    return token;
  }

  /**
   * Comprueba solo la firma. Se hace antes de tocar la base de datos porque el
   * payload lleva el tenant, y sin tenant no se puede abrir el contexto que
   * necesita la seguridad a nivel de fila para ver la fila del refresco.
   */
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'El token de refresco no es valido.',
      });
    }
  }

  /**
   * Consume un refresco ya verificado: comprueba que sigue vigente en base de
   * datos y lo revoca. Quien lo llama emite uno nuevo a continuacion.
   */
  async consumeRefreshToken(tx: Database, token: string): Promise<void> {
    const hash = TokenService.hash(token);
    const [stored] = await tx
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!stored) {
      // Firma valida pero no consta vigente: o ya se uso, o se revoco la
      // sesion. En ambos casos se rechaza.
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REVOKED',
        message: 'La sesion ya no esta activa. Vuelve a entrar.',
      });
    }

    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));
  }

  /** Cierra todas las sesiones de un usuario. */
  async revokeAllForUser(tx: Database, userId: string): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}

/** Convierte `'15m'`, `'8h'`, `'30d'` a segundos. */
export function secondsOf(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) {
    throw new Error(`Duracion no reconocida: "${ttl}". Usa formatos como 15m, 8h o 30d.`);
  }
  const amount = Number(match[1]);
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[match[2] as string] as number);
}
