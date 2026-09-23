import { PageContent } from '../components/PageContent';
import { PageHeader } from '../components/PageHeader';

/**
 * 交易頁（spec 2i SC-34.2）：2h 首頁的交易表格——篩選、依日期分組的列表、分頁——
 * 搬到這裡，右側欄放新增／編輯表單。
 *
 * 目前是 Step 1 的骨架，只確立路由與頁面寬度；內容由 Step 2 填入。
 */
export default function TransactionsPage() {
  return (
    <PageContent width="wide">
      <PageHeader title="交易" />
    </PageContent>
  );
}
