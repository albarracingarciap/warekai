import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from './env';

const base = {
  DATABASE_URL: 'postgresql://warekai:warekai@localhost:5432/warekai',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

describe('configuracion tipada', () => {
  beforeEach(() => resetEnvCache());

  it('aplica los valores por defecto', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    // La sesion de PIN dura menos que la de contrasena a proposito.
    expect(env.PIN_ACCESS_TTL).toBe('8h');
  });

  it('falla al arrancar si falta un secreto', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL } as NodeJS.ProcessEnv)).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rechaza secretos cortos', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'corto' } as NodeJS.ProcessEnv)).toThrow(
      /32 caracteres/,
    );
  });

  it('rechaza que los dos secretos sean el mismo', () => {
    expect(() =>
      loadEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET } as NodeJS.ProcessEnv),
    ).toThrow(/distintos/);
  });

  it('rechaza una URL de base de datos que no lo es', () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: 'localhost' } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });
});
