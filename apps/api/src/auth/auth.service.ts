import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthTokenResponse,
  AuthUser,
  DEFAULT_ACCOUNTS,
  ErrorCode,
  JwtPayload,
} from '@ledger/shared';
import * as bcrypt from 'bcrypt';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { LedgersService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from '../users/user.mapper';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

/**
 * 認證的業務邏輯：註冊、登入、簽發 JWT。所有與安全相關的取捨都集中在這裡，因此
 * 特別著重兩件事——密碼絕不明文外流（一律經 bcrypt 雜湊），以及登入回應不洩漏
 * 「某個 email 是否已註冊」。
 */

/** bcrypt 的成本因子；在一般硬體上每次雜湊約 100ms。 */
const BCRYPT_ROUNDS = 10;

/**
 * 一個對隨手字串算出的合法 bcrypt 雜湊。當查無使用者時拿它來比對，好讓登入
 * 不論 email 是否存在都花費相近的時間——藉此堵住一條會洩漏「哪些 email 已註冊」
 * 的計時側信道（timing side-channel）。
 */
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * 註冊使用者，並在同一個資料庫交易（transaction）內，一併備妥他的預設帳戶與
   * 個人帳本（owner 成員身分＋預設分類）。整批要嘛全部提交、要嘛全部回滾。
   *
   * 帳戶為什麼要一起建：連動帳本的交易**必須**指定帳戶，所以「有帳號卻沒帳戶」
   * 的使用者一登入就記不了任何一筆帳，而且畫面上不會有任何線索說明原因。原子性
   * 在這裡不是潔癖，是功能能不能用的問題。
   */
  async register(dto: RegisterDto): Promise<AuthUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email is already registered.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: dto.email, name: dto.name, passwordHash },
        });
        // 帳戶屬於使用者（不是帳本），所以種子放在這裡而非 createLedgerForUser。
        await tx.account.createMany({
          data: DEFAULT_ACCOUNTS.map((name) => ({ userId: created.id, name })),
        });
        // 註冊自動建立的帳本明確標成私人——這是「我自己的帳」，不是要共用的。
        await this.ledgers.createLedgerForUser(tx, created.id, {
          name: `${created.name} 的帳本`,
          kind: 'PERSONAL',
        });
        return created;
      });

      return toAuthUser(user);
    } catch (error) {
      // 唯一性約束的競態：同一個 email 幾乎同時被兩個註冊請求搶用。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.EMAIL_ALREADY_EXISTS,
          'Email is already registered.',
        );
      }
      throw error;
    }
  }

  /**
   * 驗證帳密並簽發 JWT。密碼錯誤與 email 不存在的失敗表現完全一致（同樣 401、
   * 同樣訊息、相近耗時），因此這個端點不會洩漏哪些 email 已註冊。
   */
  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // 一律執行一次比對（查無使用者時就比對 dummy 雜湊），讓回應時間與
    // 「email 是否存在」無關。
    const passwordMatches = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordMatches) {
      throw new AppException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Invalid email or password.',
      );
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload) };
  }
}
