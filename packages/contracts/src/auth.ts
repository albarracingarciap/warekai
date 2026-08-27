import { z } from 'zod';
import { nonEmptyString, uuidSchema } from './common.js';

/**
 * Roles del sistema. El control de acceso se aplica en la capa de servicio,
 * no solo en la interfaz: ocultar un boton no es una medida de seguridad.
 */
export const roleSchema = z.enum([
  /** Acceso completo, incluida la gestion de usuarios. */
  'ADMIN',
  /** Jefe de cocina: catalogo, recetas y precios de su establecimiento. */
  'CHEF',
  /** Partida: lectura de fichas tecnicas y produccion. Sin ver costes. */
  'COCINERO',
  /** Oficina: lectura de costes y escandallos, sin edicion. */
  'OFICINA',
]);
export type Role = z.infer<typeof roleSchema>;

export const permissionSchema = z.enum([
  'catalog:read',
  'catalog:write',
  'recipe:read',
  'recipe:write',
  'cost:read',
  'price:write',
  'user:manage',
]);
export type Permission = z.infer<typeof permissionSchema>;

/**
 * Matriz de permisos por rol.
 *
 * Vive en `contracts` para que la interfaz pueda ocultar lo que no aplica y la
 * API pueda exigirlo, ambas leyendo la misma fuente. La comprobacion real la
 * hace siempre el servidor.
 *
 * `COCINERO` no tiene `cost:read` a proposito: la ficha tecnica de partida
 * muestra cantidades y procedimiento, no margenes.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: [
    'catalog:read',
    'catalog:write',
    'recipe:read',
    'recipe:write',
    'cost:read',
    'price:write',
    'user:manage',
  ],
  CHEF: [
    'catalog:read',
    'catalog:write',
    'recipe:read',
    'recipe:write',
    'cost:read',
    'price:write',
  ],
  OFICINA: ['catalog:read', 'recipe:read', 'cost:read'],
  COCINERO: ['catalog:read', 'recipe:read'],
};

export const establishmentSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
});
export type EstablishmentDto = z.infer<typeof establishmentSchema>;

/** Rol de un usuario, acotado a un establecimiento o global al tenant. */
export const roleAssignmentSchema = z.object({
  role: roleSchema,
  establishmentId: uuidSchema.nullable(),
});
export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>;

export const sessionUserSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string(),
  tenantId: uuidSchema,
  roles: z.array(roleAssignmentSchema),
  establishments: z.array(establishmentSchema),
  /** `true` si la sesion se abrio con PIN: caduca antes y no permite escribir precios. */
  isPinSession: z.boolean(),
});
export type SessionUserDto = z.infer<typeof sessionUserSchema>;

export const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokensDto = z.infer<typeof tokensSchema>;

export const loginResponseSchema = tokensSchema.extend({ user: sessionUserSchema });
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Correo no valido'),
    password: z.string().min(8, 'La contrasena tiene al menos 8 caracteres'),
  })
  .strict();
export type LoginDto = z.infer<typeof loginSchema>;

/**
 * Acceso por PIN en dispositivo de confianza.
 *
 * Pensado para la tablet de una partida: teclear un correo y una contrasena
 * larga con guantes y las manos mojadas no es viable. El PIN solo funciona en
 * un dispositivo previamente registrado por un ADMIN o un CHEF, y la sesion
 * que abre es corta y de menos privilegios.
 */
export const pinLoginSchema = z
  .object({
    deviceToken: nonEmptyString(200),
    pin: z.string().regex(/^\d{4,8}$/, 'El PIN tiene entre 4 y 8 digitos'),
  })
  .strict();
export type PinLoginDto = z.infer<typeof pinLoginSchema>;

export const refreshSchema = z.object({ refreshToken: nonEmptyString(1000) }).strict();
export type RefreshDto = z.infer<typeof refreshSchema>;

export const registerDeviceSchema = z
  .object({
    name: nonEmptyString(120),
    establishmentId: uuidSchema,
  })
  .strict();
export type RegisterDeviceDto = z.infer<typeof registerDeviceSchema>;

export const trustedDeviceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  establishmentId: uuidSchema,
  /** Solo se devuelve en el alta. Despues no vuelve a mostrarse. */
  deviceToken: z.string().optional(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type TrustedDeviceDto = z.infer<typeof trustedDeviceSchema>;

export const setPinSchema = z
  .object({ pin: z.string().regex(/^\d{4,8}$/, 'El PIN tiene entre 4 y 8 digitos') })
  .strict();
export type SetPinDto = z.infer<typeof setPinSchema>;

/** Permisos efectivos de un usuario en un establecimiento concreto. */
export function permissionsFor(
  roles: readonly RoleAssignmentDto[],
  establishmentId: string | null,
): Permission[] {
  const granted = new Set<Permission>();
  for (const assignment of roles) {
    const applies =
      assignment.establishmentId === null || assignment.establishmentId === establishmentId;
    if (!applies) continue;
    for (const permission of ROLE_PERMISSIONS[assignment.role]) {
      granted.add(permission);
    }
  }
  return [...granted];
}

export function hasPermission(
  roles: readonly RoleAssignmentDto[],
  establishmentId: string | null,
  permission: Permission,
): boolean {
  return permissionsFor(roles, establishmentId).includes(permission);
}
