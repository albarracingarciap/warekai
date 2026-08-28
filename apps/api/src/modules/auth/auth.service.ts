import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  EstablishmentDto,
  LoginDto,
  LoginResponseDto,
  PinLoginDto,
  RegisterDeviceDto,
  RoleAssignmentDto,
  SessionUserDto,
  TokensDto,
  TrustedDeviceDto,
} from '@warekai/contracts';
import { compare, hash } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { recordAudit } from '../../common/audit';
import { assertPermission, type Principal } from '../../common/principal';
import { getDb, type Database } from '../../db/client';
import * as t from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(private readonly tokens: TokenService) {}

  /**
   * Resuelve el tenant antes de poder consultar `user`.
   *
   * `tenant` es la unica tabla de negocio sin RLS, precisamente porque hay que
   * leerla antes de tener contexto: sus filas solo contienen un nombre y un
   * slug. Si no se indica cual y hay exactamente uno -- el caso de esta
   * instalacion -- se usa ese. Con varios, hay que decirlo explicitamente.
   */
  async resolveTenantId(slug?: string): Promise<string> {
    const db = getDb();
    if (slug) {
      const [tenant] = await db.select().from(t.tenants).where(eq(t.tenants.slug, slug)).limit(1);
      if (!tenant) {
        throw new NotFoundException({ code: 'UNKNOWN_TENANT', message: 'Organizacion no valida.' });
      }
      return tenant.id;
    }

    const all = await db.select({ id: t.tenants.id }).from(t.tenants).limit(2);
    const only = all[0];
    if (all.length === 1 && only) {
      return only.id;
    }
    throw new BadRequestException({
      code: 'TENANT_REQUIRED',
      message: 'Indica la organizacion con la cabecera X-Warekai-Tenant.',
    });
  }

  async login(dto: LoginDto, tenantSlug?: string): Promise<LoginResponseDto> {
    const tenantId = await this.resolveTenantId(tenantSlug);

    return withTenant(tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(t.users)
        .where(and(eq(t.users.email, dto.email), eq(t.users.isActive, true)))
        .limit(1);

      // Se compara igualmente cuando el usuario no existe, para que el tiempo
      // de respuesta no revele que correos estan dados de alta.
      const passwordHash = user?.passwordHash ?? DUMMY_HASH;
      const valid = await compare(dto.password, passwordHash);
      if (!user || !valid) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Correo o contrasena incorrectos.',
        });
      }

      await tx.update(t.users).set({ lastLoginAt: new Date() }).where(eq(t.users.id, user.id));
      await recordAudit(tx, {
        tenantId,
        actorUserId: user.id,
        action: 'LOGIN',
        entity: 'user',
        entityId: user.id,
        diff: { method: 'password' },
      });

      const sessionUser = await this.buildSessionUser(tx, user, false);
      const tokens = await this.issueTokens(tx, sessionUser, null, false);
      return { ...tokens, user: sessionUser };
    });
  }

  /**
   * Acceso por PIN desde un dispositivo de confianza.
   *
   * Hacen falta las dos cosas: el token del dispositivo, que se instala una vez
   * en la tablet, y el PIN de la persona. Un PIN de cuatro digitos por si solo
   * no protege nada; atado a un aparato concreto que esta dentro de la cocina,
   * si. La sesion resultante hereda el establecimiento del dispositivo y no
   * puede tocar precios.
   */
  async loginWithPin(dto: PinLoginDto, tenantSlug?: string): Promise<LoginResponseDto> {
    const tenantId = await this.resolveTenantId(tenantSlug);

    return withTenant(tenantId, async (tx) => {
      const devices = await tx
        .select()
        .from(t.trustedDevices)
        .where(isNull(t.trustedDevices.revokedAt));

      let device: (typeof devices)[number] | undefined;
      for (const candidate of devices) {
        if (await compare(dto.deviceToken, candidate.tokenHash)) {
          device = candidate;
          break;
        }
      }
      if (!device) {
        throw new UnauthorizedException({
          code: 'UNKNOWN_DEVICE',
          message: 'Este dispositivo no esta autorizado para entrar con PIN.',
        });
      }

      const candidates = await tx.select().from(t.users).where(eq(t.users.isActive, true));

      let matched: (typeof candidates)[number] | undefined;
      for (const candidate of candidates) {
        if (candidate.pinHash && (await compare(dto.pin, candidate.pinHash))) {
          matched = candidate;
          break;
        }
      }
      if (!matched) {
        throw new UnauthorizedException({ code: 'INVALID_PIN', message: 'PIN incorrecto.' });
      }

      await tx
        .update(t.trustedDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(t.trustedDevices.id, device.id));
      await recordAudit(tx, {
        tenantId,
        actorUserId: matched.id,
        action: 'LOGIN',
        entity: 'user',
        entityId: matched.id,
        diff: { method: 'pin', deviceId: device.id },
      });

      const sessionUser = await this.buildSessionUser(tx, matched, true);
      const tokens = await this.issueTokens(tx, sessionUser, device.establishmentId, true);
      return { ...tokens, user: sessionUser };
    });
  }

  async refresh(refreshToken: string): Promise<LoginResponseDto> {
    // Primero la firma, que no necesita base de datos y trae el tenant; solo
    // entonces se puede abrir el contexto que la seguridad a nivel de fila
    // exige para ver la fila del refresco.
    const preview = await this.tokens.verifyRefreshToken(refreshToken);

    return withTenant(preview.tid, async (tx) => {
      await this.tokens.consumeRefreshToken(tx, refreshToken);
      const [user] = await tx
        .select()
        .from(t.users)
        .where(and(eq(t.users.id, preview.sub), eq(t.users.isActive, true)))
        .limit(1);
      if (!user) {
        throw new UnauthorizedException({
          code: 'USER_DISABLED',
          message: 'La cuenta ya no esta activa.',
        });
      }
      const sessionUser = await this.buildSessionUser(tx, user, false);
      const tokens = await this.issueTokens(tx, sessionUser, null, false);
      return { ...tokens, user: sessionUser };
    });
  }

  async logout(principal: Principal): Promise<void> {
    await withTenant(principal.tenantId, (tx) =>
      this.tokens.revokeAllForUser(tx, principal.userId),
    );
  }

  async me(principal: Principal): Promise<SessionUserDto> {
    return withTenant(principal.tenantId, async (tx) => {
      const [user] = await tx
        .select()
        .from(t.users)
        .where(eq(t.users.id, principal.userId))
        .limit(1);
      if (!user) {
        throw new NotFoundException({ code: 'UNKNOWN_USER', message: 'Usuario no encontrado.' });
      }
      return this.buildSessionUser(tx, user, principal.isPinSession);
    });
  }

  /** Alta de una tablet de partida. Devuelve el token una unica vez. */
  async registerDevice(principal: Principal, dto: RegisterDeviceDto): Promise<TrustedDeviceDto> {
    assertPermission(principal, 'user:manage');

    return withTenant(principal.tenantId, async (tx) => {
      const deviceToken = randomBytes(32).toString('base64url');
      const [row] = await tx
        .insert(t.trustedDevices)
        .values({
          tenantId: principal.tenantId,
          establishmentId: dto.establishmentId,
          name: dto.name,
          tokenHash: await hash(deviceToken, 10),
        })
        .returning();
      if (!row) throw new Error('No se pudo registrar el dispositivo');

      await recordAudit(tx, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        action: 'CREATE',
        entity: 'trusted_device',
        entityId: row.id,
        diff: { name: dto.name, establishmentId: dto.establishmentId },
      });

      return {
        id: row.id,
        name: row.name,
        establishmentId: row.establishmentId,
        deviceToken,
        lastSeenAt: null,
      };
    });
  }

  async setPin(principal: Principal, pin: string): Promise<void> {
    await withTenant(principal.tenantId, async (tx) => {
      await tx
        .update(t.users)
        .set({ pinHash: await hash(pin, 10) })
        .where(eq(t.users.id, principal.userId));
      await recordAudit(tx, {
        tenantId: principal.tenantId,
        actorUserId: principal.userId,
        action: 'UPDATE',
        entity: 'user',
        entityId: principal.userId,
        diff: { pin: 'actualizado' },
      });
    });
  }

  private async buildSessionUser(
    tx: Database,
    user: typeof t.users.$inferSelect,
    isPinSession: boolean,
  ): Promise<SessionUserDto> {
    const roleRows = await tx.select().from(t.userRoles).where(eq(t.userRoles.userId, user.id));
    const roles: RoleAssignmentDto[] = roleRows.map((row) => ({
      role: row.role,
      establishmentId: row.establishmentId,
    }));

    const establishmentRows = await tx.select().from(t.establishments);
    const establishments: EstablishmentDto[] = establishmentRows
      .filter((row) =>
        roles.some((r) => r.establishmentId === null || r.establishmentId === row.id),
      )
      .map((row) => ({ id: row.id, name: row.name, code: row.code }));

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      tenantId: user.tenantId,
      roles,
      establishments,
      isPinSession,
    };
  }

  private async issueTokens(
    tx: Database,
    user: SessionUserDto,
    fixedEstablishmentId: string | null,
    isPinSession: boolean,
  ): Promise<TokensDto> {
    const { token, ttl } = await this.tokens.issueAccessToken({
      sub: user.id,
      tid: user.tenantId,
      name: user.displayName,
      est: fixedEstablishmentId ?? user.establishments[0]?.id ?? null,
      // Una sesion de PIN queda clavada al establecimiento del dispositivo.
      ests: fixedEstablishmentId ? [fixedEstablishmentId] : user.establishments.map((e) => e.id),
      roles: [...user.roles],
      pin: isPinSession,
    });
    const refreshToken = await this.tokens.issueRefreshToken(tx, user.id, user.tenantId);
    return { accessToken: token, refreshToken, expiresIn: ttl };
  }
}

/**
 * Hash de una contrasena que no existe. Sirve para gastar el mismo tiempo de
 * comparacion cuando el correo no esta dado de alta.
 */
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.QEJ0nBZ7Uu4kMPLmEXAMPLEhashx';
