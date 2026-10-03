import type { CategoryIcon as CategoryIconCode, TransactionType } from '@ledger/shared';
import { isCategoryIcon } from '@ledger/shared';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Baby,
  Building2,
  Bus,
  CircleHelp,
  Coffee,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandHeart,
  HeartPulse,
  House,
  Laptop,
  type LucideIcon,
  ParkingCircle,
  PartyPopper,
  PawPrint,
  Percent,
  Plane,
  Phone,
  Receipt,
  Repeat2,
  RotateCcw,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Utensils,
  Wallet,
  Zap,
} from 'lucide-react';

interface CategoryIconProps {
  /** 分類代號；空值或清單外的值會顯示通用圖示。 */
  icon: unknown;
  /** 只有交易沒有分類時才傳入，用來挑借還或轉帳的固定圖示。 */
  transactionType?: TransactionType;
  size?: number;
  className?: string;
}

/**
 * 分類代號與 lucide 元件的唯一對照表。
 * 顯示與選擇都從 shared 清單讀取，新增代號時 TypeScript 會要求補上圖示。
 */
const CATEGORY_ICON_COMPONENTS: Record<CategoryIconCode, LucideIcon> = {
  food: Utensils,
  transport: Bus,
  shopping: ShoppingBag,
  home: House,
  fun: Gamepad2,
  health: HeartPulse,
  education: GraduationCap,
  other: Ellipsis,
  salary: Wallet,
  bonus: PartyPopper,
  investment: TrendingUp,
  coffee: Coffee,
  travel: Plane,
  pet: PawPrint,
  gift: Gift,
  clothing: Shirt,
  electronics: Laptop,
  insurance: ShieldCheck,
  tax: Receipt,
  utilities: Zap,
  phone: Phone,
  sports: Dumbbell,
  beauty: Sparkles,
  kids: Baby,
  subscription: Repeat2,
  fuel: Fuel,
  parking: ParkingCircle,
  donation: HandHeart,
  rent: Building2,
  interest: Percent,
  refund: RotateCcw,
};

/** 沒有分類時借還與轉帳各有固定圖示；支出／收入則回到通用圖示。 */
const TRANSACTION_ICON_COMPONENTS: Partial<Record<TransactionType, LucideIcon>> = {
  LEND: ArrowUpRight,
  REPAY: ArrowUpRight,
  BORROW: ArrowDownLeft,
  COLLECT: ArrowDownLeft,
  TRANSFER: ArrowLeftRight,
};

export function CategoryIcon({ icon, transactionType, size = 18, className }: CategoryIconProps) {
  const categoryIcon = isCategoryIcon(icon) ? icon : null;
  const transactionIcon =
    icon == null && transactionType ? (TRANSACTION_ICON_COMPONENTS[transactionType] ?? null) : null;
  const IconComponent = categoryIcon
    ? CATEGORY_ICON_COMPONENTS[categoryIcon]
    : (transactionIcon ?? CircleHelp);
  const iconName = categoryIcon ?? (transactionIcon ? transactionType!.toLowerCase() : 'other');

  return (
    <IconComponent
      aria-hidden="true"
      className={className}
      data-category-icon={iconName}
      focusable="false"
      size={size}
      strokeWidth={1.8}
    />
  );
}
