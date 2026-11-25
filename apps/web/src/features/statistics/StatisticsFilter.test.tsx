import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatisticsFilter } from './StatisticsFilter';
import { EMPTY_STATS_FILTERS } from './statistics-filters';
import styles from './StatisticsFilter.module.css';

// 驗證多欄容器保留分組及暫存多選的套用行為。
describe('StatisticsFilter', () => {
  it('renders grouped grids and applies selected filters', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StatisticsFilter
        filters={EMPTY_STATS_FILTERS}
        lists={{
          personIds: [{ id: 'p1', name: '小明' }],
          categoryIds: [
            { id: 'c1', name: '飲食' },
            { id: 'c2', name: '交通' },
          ],
          accountIds: [{ id: 'a1', name: '現金' }],
        }}
        onChange={onChange}
        showPeople
      />,
    );
    const trigger = screen.getByRole('button', { name: '篩選' });
    await user.click(trigger);
    const panel = within(screen.getByRole('dialog', { name: '篩選' }));
    expect(panel.getAllByRole('group')).toHaveLength(3);
    const gridClass = styles.optionGrid;
    expect(gridClass).toBeTruthy();
    if (!gridClass) throw new Error('Missing optionGrid class');
    for (const name of ['成員', '分類', '帳戶']) {
      const group = panel.getByRole('group', { name });
      expect(group.querySelector('div')).toHaveClass(gridClass);
    }
    for (const name of ['小明', '飲食', '交通', '現金', '未分類', '其他']) {
      await user.click(panel.getByRole('checkbox', { name }));
    }
    expect(onChange).not.toHaveBeenCalled();
    await user.click(panel.getByRole('button', { name: '套用' }));
    expect(onChange).toHaveBeenCalledWith({
      personIds: ['p1'],
      categoryIds: ['c1', 'c2'],
      accountIds: ['a1'],
      includeUncategorized: true,
      includeOtherAccounts: true,
    });
    expect(trigger).toHaveFocus();
  });
});
