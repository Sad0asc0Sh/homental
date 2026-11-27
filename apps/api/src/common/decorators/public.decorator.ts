import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'homental:isPublic';

/** Marks an endpoint as bypassing JwtAuthGuard (e.g. OTP, refresh, public catalog). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
