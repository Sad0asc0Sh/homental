import { Injectable } from '@nestjs/common';
import { type Env, loadEnv } from './env.schema';

/**
 * Typed, validated application configuration.
 * Parsing happens in the constructor so a bad env fails at DI time,
 * before any module is initialized (fail fast).
 */
@Injectable()
export class AppConfigService {
  readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get port(): number {
    return this.env.PORT;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  // ── Auth / JWT ────────────────────────────────────────────────────────────

  get jwtAccessSecret(): string {
    return this.env.JWT_ACCESS_SECRET;
  }

  get jwtRefreshSecret(): string {
    return this.env.JWT_REFRESH_SECRET;
  }

  get jwtAccessTtl(): string {
    return this.env.JWT_ACCESS_TTL;
  }

  get jwtRefreshTtl(): string {
    return this.env.JWT_REFRESH_TTL;
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  get otpTtlSeconds(): number {
    return this.env.OTP_TTL_SECONDS;
  }

  get otpMaxAttempts(): number {
    return this.env.OTP_MAX_ATTEMPTS;
  }

  get otpDevEcho(): boolean {
    return this.env.OTP_DEV_ECHO;
  }
}
