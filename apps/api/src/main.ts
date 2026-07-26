import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // All routes are served under /api; Swagger UI stays at /docs (see below).
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties the DTO does not declare...
      whitelist: true,
      // ...and reject the request outright when they are present, so a typo in
      // a client payload surfaces immediately instead of being silently dropped.
      forbidNonWhitelisted: true,
      // Turn plain JSON into DTO instances (and coerce primitives).
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ledger API')
    .setDescription('Personal & family expense tracking API')
    .setVersion('0.1.0')
    // Named bearer scheme so controllers can opt in with @ApiBearerAuth('jwt').
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Mounted at /docs (outside the /api prefix), the conventional docs location.
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
