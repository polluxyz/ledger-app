import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * 應用程式進入點（bootstrap）。在這裡把「全域」設定一次裝好：路由前綴、
 * 輸入驗證管線、統一錯誤 filter、Swagger 文件，最後開始監聽埠口。
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 所有路由都掛在 /api 之下；Swagger UI 另外放在 /docs（見下方）。
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      // 移除 DTO 未宣告的多餘屬性……
      whitelist: true,
      // ……而且只要出現這類屬性就直接退回請求，讓客戶端 payload 的錯字立刻現形，
      // 而不是被默默丟棄。
      forbidNonWhitelisted: true,
      // 把純 JSON 轉成 DTO 實例（並順帶轉換基本型別）。
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Ledger API')
    .setDescription('Personal & family expense tracking API')
    .setVersion('0.1.0')
    // 具名的 bearer 方案，讓 controller 用 @ApiBearerAuth('jwt') 選擇性套用。
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // 掛在 /docs（在 /api 前綴之外），是慣例的文件位置。
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
