import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, parseHomeLayoutV1 } from '@ledger/shared';
import type { HomeLayoutV1 } from '@ledger/shared';
import { HomeLayoutSurface, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PutHomeLayoutDto } from './dto/put-home-layout.dto';
import { HomeLayoutResponseDto } from './dto/home-layout-response.dto';

/** 只依 JWT 傳入的使用者隔離版面；用資料庫條件更新讓並發儲存只有一方成功。 */
@Injectable()
export class HomeLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<HomeLayoutResponseDto> {
    const row = await this.prisma.userHomeLayout.findUnique({
      where: { userId_surface: { userId, surface: HomeLayoutSurface.WEB } },
      select: { schemaVersion: true, revision: true, layout: true },
    });
    if (!row) return { schemaVersion: 1, revision: 0, layout: null };
    // 寫入端已驗證；讀取不修補資料，讓前端仍能自行驗證格式版本。
    return { ...row, layout: row.layout as HomeLayoutV1 | null };
  }

  async put(userId: string, dto: PutHomeLayoutDto): Promise<HomeLayoutResponseDto> {
    let layout: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
    if (dto.layout !== null) {
      const parsed = parseHomeLayoutV1(dto.layout);
      if (!parsed.ok) throw new BadRequestException('版面格式不正確');
      layout = parsed.layout as unknown as Prisma.InputJsonValue;
    }
    const data = { schemaVersion: dto.schemaVersion, layout };
    if (dto.expectedRevision === 0) {
      try {
        await this.prisma.userHomeLayout.create({
          data: { ...data, userId, surface: HomeLayoutSurface.WEB, revision: 1 },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw this.conflict();
        }
        throw error;
      }
    } else {
      const result = await this.prisma.userHomeLayout.updateMany({
        where: { userId, surface: HomeLayoutSurface.WEB, revision: dto.expectedRevision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (result.count === 0) throw this.conflict();
    }
    return this.get(userId);
  }

  private conflict(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
      '首頁版面已更新，請重新載入後再儲存',
    );
  }
}
