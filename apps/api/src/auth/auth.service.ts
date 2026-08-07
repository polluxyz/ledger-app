import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthTokenResponse, AuthUser, ErrorCode, JwtPayload } from '@ledger/shared';
import * as bcrypt from 'bcrypt';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { LedgersService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from '../users/user.mapper';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

/** Cost factor for bcrypt; ~100ms per hash on typical hardware. */
const BCRYPT_ROUNDS = 10;

/**
 * A valid bcrypt hash of a throwaway value, compared against when no user is
 * found so login takes similar time whether or not the email exists — closing
 * a timing side-channel that would reveal which emails are registered.
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
   * Registers a user and, in the same database transaction, provisions their
   * personal ledger (owner membership + default categories). Either everything
   * commits or nothing does — a user is never left without a ledger.
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
        await this.ledgers.createLedgerForUser(tx, created.id, `${created.name} 的帳本`);
        return created;
      });

      return toAuthUser(user);
    } catch (error) {
      // Unique-constraint race: two concurrent registrations for one email.
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
   * Verifies credentials and issues a JWT. A wrong password and an unknown
   * email fail identically (same 401, same message, similar timing) so the
   * endpoint never reveals which emails are registered.
   */
  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Always run a compare (against a dummy hash when the user is missing) to
    // keep response time independent of whether the email exists.
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
