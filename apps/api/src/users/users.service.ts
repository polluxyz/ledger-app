import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser, ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from './user.mapper';

/**
 * 使用者個人資料的業務邏輯（查詢／更新自己）。回傳一律經 toAuthUser 投影，
 * 確保 passwordHash 這類機敏欄位不外流。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      // id 來自合法的 JWT，因此只有在 token 簽發後帳號才被刪除時才會走到這裡。
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found.');
    }
    return toAuthUser(user);
  }

  async updateName(id: string, name: string): Promise<AuthUser> {
    const user = await this.prisma.user.update({ where: { id }, data: { name } });
    return toAuthUser(user);
  }
}
