import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser, ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      // The id comes from a valid JWT, so this only happens if the account was
      // deleted after the token was issued.
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found.');
    }
    return toAuthUser(user);
  }

  async updateName(id: string, name: string): Promise<AuthUser> {
    const user = await this.prisma.user.update({ where: { id }, data: { name } });
    return toAuthUser(user);
  }
}
