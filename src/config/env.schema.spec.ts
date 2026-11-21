import { loadEnv } from './env.schema';

const validEnv = {
  DATABASE_URL: 'postgresql://homental:homental_dev@localhost:5432/homental',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toBe('http://localhost:3001');
  });

  it('coerces PORT to an integer', () => {
    const env = loadEnv({ ...validEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('rejects a non-PostgreSQL DATABASE_URL with a readable message', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/app' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects missing REDIS_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow(/REDIS_URL/);
  });
});
