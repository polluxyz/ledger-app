import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  type ParseTransactionRequest,
  type ParseTransactionResponse,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { requireLedgerAccess } from '../ledgers/require-ledger-access';
import {
  LLM_PROVIDER,
  LlmProviderError,
  type LLMProvider,
  type LlmUsage,
  type LlmTimings,
} from './llm-provider';
import { AiQuotaService } from './ai-quota.service';
import { AI_QUOTA_LIMITS, type AiQuotaLimits } from './ai-quota.tokens';
import { loadAiCatalog } from './ai-catalog';
import { validateAiDrafts } from './ai-draft-validation';
import { AI_WIRE_JSON_SCHEMA } from './ai-wire-format';

/** 先授權才讀清單與呼叫模型，只回草稿；使用者確認仍走既有交易 API。 */
@Injectable()
export class AiService {
  private readonly usageLogger = new Logger('AiUsage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
    private readonly quota: AiQuotaService,
    @Inject(AI_QUOTA_LIMITS) private readonly limits: AiQuotaLimits,
  ) {}

  async parseTransaction(
    userId: string,
    dto: ParseTransactionRequest,
  ): Promise<ParseTransactionResponse> {
    await requireLedgerAccess(this.prisma, userId, dto.ledgerId, 'EDITOR', false);
    if (!this.provider.descriptor.configured) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.AI_NOT_CONFIGURED,
        'AI is not configured.',
      );
    }
    const catalog = await loadAiCatalog(this.prisma, userId, dto.ledgerId, dto.today);
    const defaults = new Map(
      await Promise.all(
        [...catalog.ledgers.values()].map(async (ledger) => {
          const result = await this.users.getRecordDefaults(userId, ledger.id);
          return [ledger.id, result.accountId] as const;
        }),
      ),
    );
    const user = dto.text.trim();
    const promptBytes =
      Buffer.byteLength(catalog.system) +
      Buffer.byteLength(JSON.stringify(AI_WIRE_JSON_SCHEMA)) +
      Buffer.byteLength(user);
    const counts = `ledgers=${catalog.ledgers.size} categories=${catalog.categories.size} accounts=${catalog.accounts.size} promptBytes=${promptBytes}`;
    const identity = `provider=${this.provider.descriptor.provider} model=${this.provider.descriptor.model ?? 'none'}`;
    let day: string;
    try {
      ({ day } = await this.quota.reserve(userId));
    } catch (error: unknown) {
      if (
        error instanceof AppException &&
        (error.errorCode === ErrorCode.AI_DAILY_LIMIT ||
          error.errorCode === ErrorCode.AI_UNAVAILABLE)
      ) {
        const outcome =
          error.errorCode === ErrorCode.AI_DAILY_LIMIT ? 'quota_user' : 'quota_global';
        this.usageLogger.log(
          `outcome=${outcome} ${identity} durationMs=0 promptTokens=unknown completionTokens=unknown drafts=0 ${counts}`,
        );
      }
      throw error;
    }
    const started = Date.now();
    let usage: LlmUsage | null = null;
    let timings: LlmTimings | undefined;
    let outcome = 'internal';
    let drafts = 0;
    let httpStatus: number | null = null;
    try {
      const response = await this.provider.complete({
        system: catalog.system,
        user,
        schema: AI_WIRE_JSON_SCHEMA,
        maxOutputTokens: this.limits.maxOutputTokens,
      });
      usage = response.usage ?? null;
      timings = response.timings;
      if (response.truncated) {
        outcome = 'truncated';
        return { drafts: [] };
      }
      const result = validateAiDrafts(response.content, catalog, defaults, dto.today);
      drafts = result.drafts.length;
      const content = response.content;
      outcome =
        !content ||
        typeof content !== 'object' ||
        !('drafts' in content) ||
        !Array.isArray(content.drafts)
          ? 'invalid'
          : drafts === 0
            ? 'empty'
            : 'success';
      return result;
    } catch (error: unknown) {
      if (!(error instanceof LlmProviderError)) throw error;
      outcome = error.kind;
      timings = error.timings;
      httpStatus = error.kind === 'http' ? error.status : null;
      // 不把原始例外與回應傳給 filter，避免模型資料進入日誌或 HTTP 回應。
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.AI_UNAVAILABLE,
        'AI is temporarily unavailable. Please try again later.',
      );
    } finally {
      const durationMs = Date.now() - started;
      await this.quota.record(userId, day, usage);
      this.usageLogger.log(
        `outcome=${outcome} ${identity} durationMs=${durationMs} promptTokens=${usage?.promptTokens ?? 'unknown'} completionTokens=${usage?.completionTokens ?? 'unknown'} drafts=${drafts} ${counts}${httpStatus === null ? '' : ` httpStatus=${httpStatus}`} tokenMs=${timings?.tokenMs ?? 'unknown'} headersMs=${timings?.headersMs ?? 'unknown'} bodyMs=${timings?.bodyMs ?? 'unknown'} reasoningTokens=${usage?.reasoningTokens ?? 'unknown'}`,
      );
    }
  }
}
