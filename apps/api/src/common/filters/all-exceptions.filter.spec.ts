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

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;
  /** Body handed to res.json(), captured with a real type instead of `any`. */
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

    // The filter logs unhandled exceptions; keep test output clean.
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
    // ThrottlerException's message is "ThrottlerException: Too Many Requests".
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
