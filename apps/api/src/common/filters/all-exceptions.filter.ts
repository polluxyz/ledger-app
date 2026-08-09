import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiErrorResponse, ErrorCode } from '@ledger/shared';
import { Response } from 'express';
import { AppException } from '../exceptions/app.exception';

/** 內建 Nest 例外本身不帶 errorCode，這裡依 HTTP 狀態碼給它們一個備援代碼。 */
const STATUS_TO_ERROR_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

/**
 * 針對「預設訊息會洩漏內部細節」的框架例外，提供乾淨、對客戶端安全的替代訊息
 * （例如 ThrottlerException 會把類別名稱塞進訊息）。只套用在非 AppException 的
 * 錯誤上——AppException 的訊息是我們刻意寫的，保留不動。
 */
const SAFE_STATUS_MESSAGE: Record<number, string> = {
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please try again later.',
};

/**
 * 把每個錯誤都渲染成 API spec 定義的「單一」回應形狀。
 *
 * 安全性：只有刻意拋出的 HttpException 的訊息會送達客戶端。其餘一律在伺服器端
 * 記 log，並以通用的 500 回應，絕不外洩堆疊、SQL 等內部細節。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(this.toErrorBody(exception));
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    } satisfies ApiErrorResponse);
  }

  private toErrorBody(exception: HttpException): ApiErrorResponse {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    // ValidationPipe 會把欄位層級的錯誤訊息放成 `message` 上的陣列。
    const details =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      Array.isArray(payload.message)
        ? payload.message.map(String)
        : undefined;

    const isAppException = exception instanceof AppException;
    const safeMessage = isAppException
      ? exception.message
      : (SAFE_STATUS_MESSAGE[statusCode] ?? exception.message);

    return {
      statusCode,
      errorCode: isAppException
        ? exception.errorCode
        : (STATUS_TO_ERROR_CODE[statusCode] ?? ErrorCode.INTERNAL_ERROR),
      message: details ? 'Validation failed' : safeMessage,
      ...(details ? { details } : {}),
    };
  }
}
