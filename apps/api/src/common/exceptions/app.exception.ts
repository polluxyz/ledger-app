import { HttpException } from '@nestjs/common';

/**
 * 應用層例外：在 HTTP 狀態碼之外，額外帶一個穩定、機器可讀的 errorCode。
 *
 * 當客戶端需要分辨「究竟是哪一種失敗」時（例如兩種不同原因的 409），service 就
 * 拋這個，而非光禿禿的 Nest 例外。AllExceptionsFilter 會從這個類別讀出該代碼。
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
