import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { correlationIdMiddleware } from './common/correlation-id.middleware.js';
import { RuntimeConfigService } from './runtime-config/runtime-config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const allowedWebOrigins = (process.env.WEB_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({ origin: allowedWebOrigins, credentials: true });
  app.use(correlationIdMiddleware);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready', 'api/docs'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Finance CRM API')
      .setDescription('Internal Finance CRM API')
      .setVersion('1.0')
      .addServer('/api/v1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = app.get(RuntimeConfigService).value.apiPort;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
