import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function createHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/api/v1/auth/otp/verify' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function prismaError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('mock message', {
    code,
    clientVersion: '6.19.3',
    meta,
  });
}

describe('PrismaExceptionFilter (Part A hotfix #2 — direct ExceptionFilter)', () => {
  const filter = new PrismaExceptionFilter();

  it('maps P2002 unique-constraint to 409 with Persian message', () => {
    const { host, status, json } = createHost();
    filter.catch(prismaError('P2002', { target: ['User_phone_key'] }), host);
    expect(status).toHaveBeenCalledWith(409);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['statusCode']).toBe(409);
    expect(body['message']).toContain('قبلاً ثبت شده');
  });

  it('maps P2025 record-not-found to 404 with Persian message', () => {
    const { host, status, json } = createHost();
    filter.catch(prismaError('P2025'), host);
    expect(status).toHaveBeenCalledWith(404);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['statusCode']).toBe(404);
    expect(body['message']).toContain('یافت نشد');
  });

  it('maps P2003 foreign-key failure to 400 with Persian message', () => {
    const { host, status, json } = createHost();
    filter.catch(prismaError('P2003'), host);
    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['statusCode']).toBe(400);
    expect(body['message']).toContain('ارتباط');
  });

  it('maps unknown Prisma codes to 500 without leaking internals', () => {
    const { host, status, json } = createHost();
    filter.catch(prismaError('P9999'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(body['message']).toContain('خطای پایگاه داده');
    expect(body['message']).not.toContain('mock message');
  });
});
