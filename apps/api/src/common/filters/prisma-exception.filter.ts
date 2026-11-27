import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { normalizeHttpException } from './all-exceptions.filter';

/**
 * Maps well-known Prisma error codes to HTTP responses with clean Persian
 * messages.
 *
 * Part A hotfix #2:
 *  - Implements `ExceptionFilter` DIRECTLY (the old `extends BaseExceptionFilter`
 *    version crashed at runtime because it was constructed without an
 *    `httpAdapter`, and `super.catch` needs one).
 *  - Must be registered SECOND via `useGlobalFilters(All, Prisma)` — Nest runs
 *    global filters in reverse registration order, so this filter evaluates
 *    FIRST for `PrismaClientKnownRequestError` and the catch-all never sees it.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const mapped = this.map(exception);
    const { status, body } = normalizeHttpException(mapped, request.url);

    if (status >= 500) {
      this.logger.error(
        `Prisma ${exception.code} at ${request.method} ${request.url} -> ${status}`,
        exception.stack,
      );
    }
    response.status(status).json(body);
  }

  private map(exception: Prisma.PrismaClientKnownRequestError): HttpException {
    switch (exception.code) {
      case 'P2002': {
        const target = (exception.meta as { target?: string[] } | undefined)?.target;
        return new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: 'این مقدار قبلاً ثبت شده است و نمی‌توان دوباره ثبتش کرد.',
          fields: target,
          prismaCode: 'P2002',
        });
      }
      case 'P2025':
        return new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'مورد درخواستی یافت نشد.',
          prismaCode: 'P2025',
        });
      case 'P2003':
        return new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'ارتباط با داده‌ی مرتبط معتبر نیست؛ آیتم مرتبط وجود ندارد یا حذف شده است.',
          prismaCode: 'P2003',
        });
      default:
        return new InternalServerErrorException({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'خطای پایگاه داده رخ داد.',
          prismaCode: exception.code,
        });
    }
  }
}
