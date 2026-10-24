import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AI_CLOCK, AI_QUOTA_LIMITS, type AiClock, type AiQuotaLimits } from './ai-quota.tokens';
import type { LlmUsage } from './llm-provider';

/** 個人與全站固定依序寫入同一個短交易，避免超扣與互相等待。 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger('AiQuota');
  private readonly transactionOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 3000,
    timeout: 5000,
  };

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_QUOTA_LIMITS) private readonly limits: AiQuotaLimits,
    @Inject(AI_CLOCK) private readonly clock: AiClock,
  ) {}

  async reserve(userId: string): Promise<{ day: string }> {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(this.clock());
    const { perUserDaily, globalDaily } = this.limits;
    // INSERT 分支沒有上限條件，停用時必須在接觸資料庫前擋下。
    if (perUserDaily === 0) throw this.userLimit();
    if (globalDaily === 0) throw this.globalLimit();
    try {
      await this.prisma.$transaction(async (tx) => {
        const personal = await tx.$queryRaw<{ calls: number }[]>`
          INSERT INTO "AiParseDailyUsage" ("userId", "day", "calls", "usageUnknownCalls", "updatedAt")
          VALUES (${userId}, ${day}::date, 1, 1, now())
          ON CONFLICT ("userId", "day") DO UPDATE
          SET "calls" = "AiParseDailyUsage"."calls" + 1,
              "usageUnknownCalls" = "AiParseDailyUsage"."usageUnknownCalls" + 1,
              "updatedAt" = now()
          WHERE "AiParseDailyUsage"."calls" < ${perUserDaily}
          RETURNING "calls"`;
        if (personal.length === 0) throw this.userLimit();
        const global = await tx.$queryRaw<{ calls: number }[]>`
          INSERT INTO "AiDailyUsage" ("day", "calls", "usageUnknownCalls", "updatedAt")
          VALUES (${day}::date, 1, 1, now())
          ON CONFLICT ("day") DO UPDATE
          SET "calls" = "AiDailyUsage"."calls" + 1,
              "usageUnknownCalls" = "AiDailyUsage"."usageUnknownCalls" + 1,
              "updatedAt" = now()
          WHERE "AiDailyUsage"."calls" < ${globalDaily}
          RETURNING "calls"`;
        if (global.length === 0) throw this.globalLimit();
      }, this.transactionOptions);
      return { day };
    } catch (error: unknown) {
      if (error instanceof AppException) throw error;
      // 原始資料庫錯誤可能含參數；不可交給全域 filter 記錄 stack。
      this.logger.error('AI quota reserve failed');
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.INTERNAL_ERROR,
        'Internal server error',
      );
    }
  }

  async record(userId: string, day: string, usage: LlmUsage | null): Promise<void> {
    if (!usage) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          UPDATE "AiParseDailyUsage"
          SET "promptTokens" = "promptTokens" + ${BigInt(usage.promptTokens)},
              "completionTokens" = "completionTokens" + ${BigInt(usage.completionTokens)},
              "usageUnknownCalls" = "usageUnknownCalls" - 1, "updatedAt" = now()
          WHERE "userId" = ${userId} AND "day" = ${day}::date`;
        await tx.$queryRaw`
          UPDATE "AiDailyUsage"
          SET "promptTokens" = "promptTokens" + ${BigInt(usage.promptTokens)},
              "completionTokens" = "completionTokens" + ${BigInt(usage.completionTokens)},
              "usageUnknownCalls" = "usageUnknownCalls" - 1, "updatedAt" = now()
          WHERE "day" = ${day}::date`;
      }, this.transactionOptions);
    } catch {
      // 用量為盡力記錄；回寫失敗保留未知次數，不改變草稿或 provider 錯誤回應。
      this.logger.error('AI usage record failed');
    }
  }

  private userLimit() {
    return new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.AI_DAILY_LIMIT,
      'Daily AI limit reached.',
    );
  }

  private globalLimit() {
    return new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.AI_UNAVAILABLE,
      'AI is temporarily unavailable. Please try again later.',
    );
  }
}
