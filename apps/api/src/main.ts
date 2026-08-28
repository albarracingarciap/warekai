import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { applyZodSchemas } from './common/openapi';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { ESTABLISHMENT_HEADER, TENANT_HEADER } from './modules/auth/auth.guard';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.use(helmet());
  app.enableCors({
    origin: env.API_CORS_ORIGIN.split(',').map((value) => value.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', ESTABLISHMENT_HEADER, TENANT_HEADER],
  });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new DomainExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Warekai API')
    .setDescription(
      'Gestion de cocina profesional: catalogo, recetario y escandallos.\n\n' +
        'Convenciones: los importes viajan como entero de centimos; los factores decimales ' +
        '(densidades, mermas, IVA) viajan como cadena para no perder exactitud. El ' +
        'establecimiento activo se indica con la cabecera `' +
        ESTABLISHMENT_HEADER +
        '`.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = applyZodSchemas(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.API_PORT);
  new Logger('Warekai').log(
    `API escuchando en http://localhost:${env.API_PORT}/api  ·  OpenAPI en /docs`,
  );
}

void bootstrap();
