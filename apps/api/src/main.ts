import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
