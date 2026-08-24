import { Client } from 'pg';
import { requireEnv } from './env';

/**
 * 測試資料庫的清空工具。
 *
 * 這是整套 e2e 裡**唯一**直接寫資料庫的地方（D3）。業務資料一律打真實 API 建立，
 * 否則會繞過驗證與業務規則，測出來的狀態可能是產品根本走不到的。
 *
 * 為什麼用 `pg` 而不是 `@prisma/client`：產生出來的 Prisma Client 綁在 api 的
 * schema 與 api 的 node_modules，從 web 匯入會拿到空殼。清資料只是一行 SQL。
 */

/**
 * 保險絲：只允許連到名字以 `_test` 結尾的資料庫。
 *
 * TRUNCATE 是不可逆的。萬一哪天 `DATABASE_URL` 被指到開發或正式資料庫，
 * 這裡要當場攔下來，而不是清完才發現（SC-E4）。
 */
function assertTestDatabase(connectionString: string): string {
  const databaseName = new URL(connectionString).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(`拒絕清空資料庫「${databaseName}」：e2e 只能連到名稱以 _test 結尾的資料庫。`);
  }
  return databaseName;
}

/**
 * 清空 public schema 底下的每一張資料表。
 *
 * 資料表清單是**查出來的**，不是寫死的（D2）。寫死清單的症狀很難認：新增資料表
 * 後忘了補，單獨跑會過、整套跑才爛，因為前一個測試留下的資料汙染了後面的。
 *
 * `_prisma_migrations` 要留著——那是 migration 的紀錄，清掉的話下次
 * `migrate deploy` 會以為所有 migration 都沒跑過。
 */
export async function resetDb(): Promise<void> {
  const connectionString = requireEnv('DATABASE_URL');
  assertTestDatabase(connectionString);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0) {
      return;
    }
    // 一次清完：資料表之間有外鍵，分開清會被關聯擋住。CASCADE 連帶處理。
    const tableList = rows.map((row) => `"${row.tablename}"`).join(', ');
    await client.query(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}
