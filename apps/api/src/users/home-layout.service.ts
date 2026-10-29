import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, parseHomeLayoutV1 } from '@ledger/shared';
import type { HomeLayoutV1 } from '@ledger/shared';
import { HomeLayoutSurface, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { PutHomeLayoutDto } from './dto/put-home-layout.dto';
import { HomeLayoutResponseDto } from './dto/home-layout-response.dto';

/**
 * 只依 JWT 傳入的使用者隔離版面；revision 永遠遞增，避免舊工作階段在回繞後覆蓋新版面。
 * 條件寫入直接取回快照，避免另外 GET 時讀到其他請求稍後存入的版面。
 */
@Injectable()
export class HomeLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<HomeLayoutResponseDto> {
    const row = await this.prisma.userHomeLayout.findUnique({
      where: { userId_surface: { userId, surface: HomeLayoutSurface.WEB } },
      select: { schemaVersion: true, revision: true, layout: true },
    });
    if (!row) return { schemaVersion: 1, revision: 0, layout: null };
    return this.toResponse(row);
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
        const row = await this.prisma.userHomeLayout.create({
          data: { ...data, userId, surface: HomeLayoutSurface.WEB, revision: 1 },
          select: { schemaVersion: true, revision: true, layout: true },
        });
        return this.toResponse(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw this.conflict();
        }
        throw error;
      }
    } else {
      try {
        // 主鍵與舊 revision 一起比對，資料庫在同一個動作遞增並回傳這次寫入的列。
        const row = await this.prisma.userHomeLayout.update({
          where: {
            userId_surface: { userId, surface: HomeLayoutSurface.WEB },
            revision: BigInt(dto.expectedRevision),
          },
          data: { ...data, revision: { increment: 1 } },
          select: { schemaVersion: true, revision: true, layout: true },
        });
        return this.toResponse(row);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw this.conflict();
        }
        throw error;
      }
    }
  }

  private toResponse(row: {
    schemaVersion: number;
    revision: bigint;
    layout: Prisma.JsonValue | null;
  }): HomeLayoutResponseDto {
    // 拒絕失真的數字；一般內部錯誤交由全站 filter 遮蔽，不讓 BigInt 進入 JSON。
    if (row.revision < 0n || row.revision > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Home layout revision is outside the safe integer range');
    }
    // 寫入端已驗證；讀取不修補資料，讓前端仍能自行驗證格式版本。
    return {
      ...row,
      revision: Number(row.revision),
      layout: row.layout as HomeLayoutV1 | null,
    };
  }

  private conflict(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
      '首頁版面已更新，請重新載入後再儲存',
    );
  }
}
