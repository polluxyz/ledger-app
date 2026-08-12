import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { Env } from './config/env.validation';

/**
 * 應用程式進入點（bootstrap）。在這裡把「全域」設定一次裝好：CORS、路由前綴、
 * 輸入驗證管線、統一錯誤 filter、Swagger 文件，最後開始監聽埠口。
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  /**
   * 只放行設定中的前端來源。Web 前端與 API 位於不同 port／網域（不同來源），
   * 瀏覽器預設會擋下跨來源請求，需由後端明示允許。
   *
   * 不開 `credentials`：認證走 Authorization 標頭的 Bearer token，不使用
   * cookie，因此毋須允許跨來源夾帶憑證——維持較嚴的設定。
   */
  app.enableCors({
    origin: config.get('CORS_ORIGIN', { infer: true }),
  });

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
