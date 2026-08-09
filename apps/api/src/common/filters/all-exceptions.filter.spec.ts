import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import { AppException } from '../exceptions/app.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * AllExceptionsFilter 的單元測試。用假的 response（攔截 status/json）驗證統一錯誤
 * 格式：AppException 帶自己的 errorCode、內建例外依狀態碼給備援碼、驗證失敗附
 * details、429 換成乾淨訊息，以及最關鍵的——非預期錯誤絕不外洩內部細節。
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;
  /** 交給 res.json() 的 body，用實際型別攔下來（避免 `any`）。 */
  let sentBody: unknown;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    sentBody = undefined;
    json = jest.fn((body: unknown) => {
      sentBody = body;
    });
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    // filter 會 log 未處理的例外；這裡把 log 靜音，保持測試輸出乾淨。
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the error code carried by an AppException', () => {
    filter.catch(
      new AppException(
        HttpStatus.CONFLICT,
        'LAST_OWNER_CANNOT_LEAVE',
        'A ledger must have at least one owner.',
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      errorCode: 'LAST_OWNER_CANNOT_LEAVE',
      message: 'A ledger must have at least one owner.',
    });
  });

  it('falls back to a status-derived code for built-in exceptions', () => {
    filter.catch(new NotFoundException('Ledger not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Ledger not found',
    });
  });

  it('exposes field-level messages for validation failures', () => {
    filter.catch(
      new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: ['amount must be an integer', 'date should not be empty'],
        error: 'Bad Request',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: ['amount must be an integer', 'date should not be empty'],
    });
  });

  it('replaces the leaky 429 message with a clean one', () => {
    // ThrottlerException 的原始訊息是 "ThrottlerException: Too Many Requests"。
    filter.catch(
      new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      errorCode: ErrorCode.TOO_MANY_REQUESTS,
      message: 'Too many requests. Please try again later.',
    });
  });

  it('never leaks internals from an unexpected error', () => {
    filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:5432 — password=hunter2'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });

    const serialized = JSON.stringify(sentBody);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('5432');
  });
});
