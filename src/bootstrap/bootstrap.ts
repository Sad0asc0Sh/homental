import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { PrismaExceptionFilter } from '@common/filters/prisma-exception.filter';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import { AppConfigService } from '@config/app-config.service';
import { AppModule } from '../app.module';

/**
 * Central application assembly (global pipes, filters, interceptors, security
 * middleware, OpenAPI docs, graceful shutdown). main.ts stays a thin shell.
 */
export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get(AppConfigService);

  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new BigIntSerializerInterceptor());
  // Prisma filter first (specific), catch-all second.
  app.useGlobalFilters(new PrismaExceptionFilter(), new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Homental API')
    .setDescription('سامانه هومنتال — خدمات امنیت و آرامش (فاز ۱: مشهد)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  app.enableShutdownHooks();
  return app;
}
