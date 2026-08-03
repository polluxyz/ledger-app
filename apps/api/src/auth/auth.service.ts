import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser, ErrorCode } from '@ledger/shared';
import * as bcrypt from 'bcrypt';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { LedgersService } from '../ledgers/ledgers.service';
import { PrismaService } from '../prisma/prisma.service';
import type { RegisterDto } from './dto/register.dto';

/** Cost factor for bcrypt; ~100ms per hash on typical hardware. */
const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgers: LedgersService,
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

      return this.toAuthUser(user);
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

  private toAuthUser(user: { id: string; email: string; name: string; createdAt: Date }): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
