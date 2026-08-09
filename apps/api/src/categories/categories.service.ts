import { HttpStatus, Injectable } from '@nestjs/common';
import { Category, ErrorCode, TransactionType } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 分類的業務邏輯。分類永遠隸屬某個帳本，且與交易共用同一種型別（INCOME／
 * EXPENSE）。兩條主要規則：同一帳本、同一型別下名稱唯一；只要有交易（含已軟
 * 刪除者）引用，就不得刪除該分類。
 */

/** 從資料庫選出的分類資料列。 */
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

  /** 列出帳本的分類，可選擇以型別篩選。 */
  async list(ledgerId: string, type?: TransactionType): Promise<Category[]> {
    const categories = await this.prisma.category.findMany({
      where: { ledgerId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return categories.map((category) => this.toCategory(category));
  }

  /** 新增分類。名稱在（帳本, 型別）範圍內必須唯一（靠 DB 唯一索引擋重複）。 */
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

  /** 分類改名（型別不可變——避免既有交易的型別對應被打亂）。 */
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

  /** 刪除分類，除非有任何交易引用它。 */
  async remove(ledgerId: string, categoryId: string): Promise<void> {
    await this.getOwned(ledgerId, categoryId);

    // 計數包含已軟刪除的交易：歷史紀錄必須保持可追溯（分類名不能憑空消失）。
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
   * 載入分類並確認它屬於指定帳本。不符時一律回 404，避免呼叫者藉此探測其他帳本
   * 裡有哪些分類。
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
