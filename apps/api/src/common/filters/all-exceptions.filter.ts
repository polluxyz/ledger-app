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

/** Fallback error codes for the built-in Nest exceptions, which carry no code. */
const STATUS_TO_ERROR_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

/**
 * Renders every error as the single response shape defined in the API spec.
 *
 * Security: only messages from deliberate HttpExceptions reach the client.
 * Anything else is logged server-side and reported as a generic 500, so
 * stack traces, SQL and other internals are never leaked.
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

    // ValidationPipe puts its field-level messages in an array on `message`.
    const details =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      Array.isArray(payload.message)
        ? payload.message.map(String)
        : undefined;

    return {
      statusCode,
      errorCode:
        exception instanceof AppException
          ? exception.errorCode
          : (STATUS_TO_ERROR_CODE[statusCode] ?? ErrorCode.INTERNAL_ERROR),
      message: details ? 'Validation failed' : exception.message,
      ...(details ? { details } : {}),
    };
  }
}
