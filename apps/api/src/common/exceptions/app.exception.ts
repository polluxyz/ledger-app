import { HttpException } from '@nestjs/common';

/**
 * Application exception carrying a stable, machine-readable error code
 * alongside the HTTP status.
 *
 * Services throw this (rather than the bare Nest exceptions) whenever the
 * client needs to distinguish *which* failure occurred — e.g. two different
 * 409s. AllExceptionsFilter reads the code off this class.
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message, status);
  }
}
