import { loadEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://homental:homental_dev@localhost:5432/homental',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'unit-test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'unit-test-refresh-secret-0123456789abcde',
};

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toBe('http://localhost:3001,http://localhost:3002');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('30d');
    expect(env.OTP_TTL_SECONDS).toBe(120);
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.OTP_DEV_ECHO).toBe(false);
  });

  it('coerces PORT to an integer', () => {
    const env = loadEnv({ ...validEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('parses booleanish OTP_DEV_ECHO', () => {
    expect(loadEnv({ ...validEnv, OTP_DEV_ECHO: 'true' }).OTP_DEV_ECHO).toBe(true);
    expect(loadEnv({ ...validEnv, OTP_DEV_ECHO: '0' }).OTP_DEV_ECHO).toBe(false);
    expect(loadEnv({ ...validEnv, OTP_DEV_ECHO: 'false' }).OTP_DEV_ECHO).toBe(false);
  });

  it('rejects a non-PostgreSQL DATABASE_URL with a readable message', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/app' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects missing REDIS_URL', () => {
    const withoutRedis: Record<string, string> = { ...validEnv };
    delete withoutRedis.REDIS_URL;
    expect(() => loadEnv(withoutRedis)).toThrow(/REDIS_URL/);
  });

  it('rejects JWT secrets shorter than 32 characters', () => {
    expect(() =>
      loadEnv({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects invalid JWT TTL formats', () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_TTL: '15minutes' })).toThrow(
      /JWT_ACCESS_TTL/,
    );
  });

  it('fails fast when OTP_DEV_ECHO is enabled in production', () => {
    expect(() =>
      loadEnv({ ...validEnv, NODE_ENV: 'production', OTP_DEV_ECHO: 'true' }),
    ).toThrow(/OTP_DEV_ECHO/);
  });

  it('allows OTP_DEV_ECHO outside production', () => {
    const env = loadEnv({ ...validEnv, NODE_ENV: 'development', OTP_DEV_ECHO: 'true' });
    expect(env.OTP_DEV_ECHO).toBe(true);
  });
});
