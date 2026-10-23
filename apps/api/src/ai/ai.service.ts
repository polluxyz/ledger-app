import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ParseTransactionRequest,
  type ParseTransactionResponse,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { requireLedgerAccess } from '../ledgers/require-ledger-access';
import { LLM_PROVIDER, LlmProviderError, type LLMProvider } from './llm-provider';
import { loadAiCatalog } from './ai-catalog';
import { validateAiDrafts } from './ai-draft-validation';
import { AI_WIRE_JSON_SCHEMA } from './ai-wire-format';

/** 先授權才讀清單與呼叫模型，只回草稿；使用者確認仍走既有交易 API。 */
@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    @Inject(LLM_PROVIDER) private readonly provider: LLMProvider,
  ) {}

  async parseTransaction(
    userId: string,
    dto: ParseTransactionRequest,
  ): Promise<ParseTransactionResponse> {
    await requireLedgerAccess(this.prisma, userId, dto.ledgerId, 'EDITOR', false);
    const catalog = await loadAiCatalog(this.prisma, userId, dto.ledgerId, dto.today);
    const defaults = new Map(
      await Promise.all(
        [...catalog.ledgers.values()].map(async (ledger) => {
          const result = await this.users.getRecordDefaults(userId, ledger.id);
          return [ledger.id, result.accountId] as const;
        }),
      ),
    );
    try {
      const response = await this.provider.complete({
        system: catalog.system,
        user: dto.text.trim(),
        schema: AI_WIRE_JSON_SCHEMA,
      });
      return validateAiDrafts(response.content, catalog, defaults, dto.today);
    } catch (error: unknown) {
      if (!(error instanceof LlmProviderError)) throw error;
      // 不把原始例外與回應傳給 filter，避免模型資料進入日誌或 HTTP 回應。
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.AI_UNAVAILABLE,
        'AI is temporarily unavailable. Please try again later.',
      );
    }
  }
}
