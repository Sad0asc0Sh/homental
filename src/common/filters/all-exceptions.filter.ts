import type {
  ArgumentsHost} from '@nestjs/common';
import {
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface HttpErrorBody {
  statusCode: number;
  message: string;
  error?: string;
  path?: string;
  timestamp: string;
}

interface NormalizedError {
  status: number;
  body: HttpErrorBody;
}

/**
 * Last-resort filter: turns any uncaught error into a consistent envelope.
 * 5xx errors never leak internals to the client — they are logged instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const { status, body } = this.normalize(exception, request.url);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json(body);
  }

  private normalize(exception: unknown, path: string): NormalizedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let message: string = exception.message;
      let error: string | undefined;

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        if (typeof body['message'] === 'string') {
          message = body['message'];
        } else if (Array.isArray(body['message'])) {
          message = (body['message'] as string[]).join(' | ');
        }
        if (typeof body['error'] === 'string') error = body['error'];
      }
      return { status, body: this.build(status, message, path, error) };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: this.build(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'خطای غیرمنتظره‌ای در سرور رخ داد. لطفاً بعداً دوباره تلاش کنید.',
        path,
      ),
    };
  }

  private build(status: number, message: string, path: string, error?: string): HttpErrorBody {
    return { statusCode: status, message, error, path, timestamp: new Date().toISOString() };
  }
}
