import { HttpStatus, Injectable } from '@nestjs/common';
import { Category, ErrorCode, TransactionType } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A category row as selected from the database. */
interface CategoryRow {
  id: string;
  ledgerId: string;
  name: string;
  type: TransactionType;
  createdAt: Date;
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lists a ledger's categories, optionally filtered by type. */
  async list(ledgerId: string, type?: TransactionType): Promise<Category[]> {
    const categories = await this.prisma.category.findMany({
      where: { ledgerId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return categories.map((category) => this.toCategory(category));
  }

  /** Creates a category. Name must be unique within (ledger, type). */
  async create(ledgerId: string, name: string, type: TransactionType): Promise<Category> {
    try {
      const category = await this.prisma.category.create({
        data: { ledgerId, name, type },
      });
      return this.toCategory(category);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** Renames a category (type is immutable). */
  async rename(ledgerId: string, categoryId: string, name: string): Promise<Category> {
    await this.getOwned(ledgerId, categoryId);
    try {
      const category = await this.prisma.category.update({
        where: { id: categoryId },
        data: { name },
      });
      return this.toCategory(category);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** Deletes a category, unless any transaction references it. */
  async remove(ledgerId: string, categoryId: string): Promise<void> {
    await this.getOwned(ledgerId, categoryId);

    // Count includes soft-deleted transactions: history must stay attributable.
    const referencing = await this.prisma.transaction.count({
      where: { categoryId },
    });
    if (referencing > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CATEGORY_IN_USE,
        'Cannot delete a category that transactions reference.',
      );
    }

    await this.prisma.category.delete({ where: { id: categoryId } });
  }

  /**
   * Loads a category and asserts it belongs to the given ledger. A mismatch is
   * reported as 404 so callers cannot probe categories in other ledgers.
   */
  private async getOwned(ledgerId: string, categoryId: string): Promise<CategoryRow> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category || category.ledgerId !== ledgerId) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Category not found.');
    }
    return category;
  }

  private nameTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.CATEGORY_NAME_TAKEN,
      'A category with this name and type already exists.',
    );
  }

  private toCategory(category: CategoryRow): Category {
    return {
      id: category.id,
      name: category.name,
      type: category.type,
      createdAt: category.createdAt.toISOString(),
    };
  }
}
