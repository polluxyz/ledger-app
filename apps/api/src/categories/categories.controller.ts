import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Category } from '@ledger/shared';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireLedgerRole('VIEWER')
  list(
    @Param('ledgerId') ledgerId: string,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<Category[]> {
    return this.categories.list(ledgerId, query.type);
  }

  @Post()
  @RequireLedgerRole('EDITOR')
  create(@Param('ledgerId') ledgerId: string, @Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categories.create(ledgerId, dto.name, dto.type);
  }

  @Patch(':categoryId')
  @RequireLedgerRole('EDITOR')
  rename(
    @Param('ledgerId') ledgerId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<Category> {
    return this.categories.rename(ledgerId, categoryId, dto.name);
  }

  @Delete(':categoryId')
  @RequireLedgerRole('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('ledgerId') ledgerId: string,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    return this.categories.remove(ledgerId, categoryId);
  }
}
