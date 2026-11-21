import { z } from 'zod';

/** Accepts boolean or 'true'/'1'/'false'/'0' strings (env vars are strings). */
const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['true', '1'].includes(value.trim().toLowerCase()),
  );

/** Durations used by JWT/OTP config: `15m`, `30d`, `120s`, `2h`. */
const durationString = z
  .string()
  .regex(/^[1-9]\d*(s|m|h|d)$/, { message: 'must be a duration like 15m, 30d, 120s, 2h' });

/**
 * Homental environment contract (Invariant 12).
 * All env access flows through here — parsed & validated once, fail fast.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'must be a PostgreSQL connection string (postgresql://...)',
      }),
    REDIS_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith('redis://') || value.startsWith('rediss://'), {
        message: 'must be a Redis connection string (redis://...)',
      }),
    CORS_ORIGINS: z.string().default('http://localhost:3001'),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL: durationString.default('15m'),
    JWT_REFRESH_TTL: durationString.default('30d'),

    OTP_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_DEV_ECHO: booleanish.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.OTP_DEV_ECHO) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OTP_DEV_ECHO'],
        message: 'OTP_DEV_ECHO=true is forbidden when NODE_ENV=production (it echoes OTP codes in API responses)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration — fix these and restart:\n${details}`);
  }
  return result.data;
}
