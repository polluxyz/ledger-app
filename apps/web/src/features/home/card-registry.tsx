import type { ReactElement, ReactNode } from 'react';
import type { HomeCardId } from '@ledger/shared';
import { HomeCard, type HomeCardProps } from './HomeCard';

export interface HomeCardRenderProps extends Omit<HomeCardProps, 'cardId' | 'title'> {
  title?: ReactNode;
}

export interface HomeCardRegistration {
  title: string;
  /** 以 CSS px 記錄不換行時所需的最小卡片寬度。 */
  minWidthPx: number;
  render: (props: HomeCardRenderProps) => ReactElement;
}

function registerCard(cardId: HomeCardId, title: string, minWidthPx: number): HomeCardRegistration {
  return {
    title,
    minWidthPx,
    render: (props) => <HomeCard {...props} cardId={cardId} title={props.title ?? title} />,
  };
}

/** 版面節點只使用這份登記表，卡片標題、最小寬度和外框不會各自分散定義。 */
export const HOME_CARD_REGISTRY: Record<HomeCardId, HomeCardRegistration> = {
  expense: registerCard('expense', '本月支出', 314),
  income: registerCard('income', '本月收入', 314),
  net: registerCard('net', '結餘', 314),
  trend: registerCard('trend', '資產趨勢', 352),
  categories: registerCard('categories', '本月支出', 314),
  activity: registerCard('activity', '最近｜標註', 314),
  accounts: registerCard('accounts', '帳戶', 314),
  debts: registerCard('debts', '借還', 314),
};
