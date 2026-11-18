import { expect, test } from '@playwright/test';
import { resetDb } from './db';
import { API_BASE_URL } from './env';
import { openUserMenu } from './ui';

/** 透過畫面登入與登出，驗證伺服器拒絕剛撤銷的憑證。 */
test('登出後原憑證不能再讀取使用者', async ({ page, request }) => {
  await resetDb();
  const email = 'logout@example.com';
  const password = 'sup3rsecret';
  const registered = await request.post(`${API_BASE_URL}/auth/register`, {
    data: { email, password, name: 'Logout' },
  });
  expect(registered.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '登入' });
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('密碼').fill(password);
  await dialog.getByRole('button', { name: '登入' }).click();
  await openUserMenu(page);
  const token = await page.evaluate(() => localStorage.getItem('ledger.accessToken'));
  expect(token).toBeTruthy();
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible();
  const response = await request.get(`${API_BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(401);
});
