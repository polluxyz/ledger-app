import { Injectable } from '@nestjs/common';
import { SHARED_PACKAGE_NAME } from '@ledger/shared';

@Injectable()
export class AppService {
  getHello(): string {
    return `Hello World! (types shared via ${SHARED_PACKAGE_NAME})`;
  }
}
