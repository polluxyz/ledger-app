import { createAccount, createCategory, listAccounts, personalLedger } from './api';
import { expect, test } from './fixtures';
import { openTransactions } from './ui';

const VOICE_TEXT = '早餐 60 現金、午餐 120 刷卡';

interface FakeRecognitionInstance {
  startCalls: number;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: ((event: Event) => void) | null;
  onresult: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
  emitAudioStart(): void;
  emitResult(transcript: string): void;
}

interface VoiceTestControl {
  instances: FakeRecognitionInstance[];
  emitAudioStart(index: number): void;
  emitResult(index: number, transcript: string): void;
}

declare global {
  interface Window {
    __voiceTestControl?: VoiceTestControl;
  }
}

/** 以 page.addInitScript 注入可手動觸發事件的假辨識器，不使用真實麥克風或音檔。 */
async function installFakeRecognition(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const control: VoiceTestControl = {
      instances: [],
      emitAudioStart(index) {
        this.instances[index]?.emitAudioStart();
      },
      emitResult(index, transcript) {
        this.instances[index]?.emitResult(transcript);
      },
    };

    class FakeSpeechRecognition implements FakeRecognitionInstance {
      startCalls = 0;
      lang = 'en-US';
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      onstart: ((event: Event) => void) | null = null;
      onaudiostart: ((event: Event) => void) | null = null;
      onaudioend: ((event: Event) => void) | null = null;
      onresult: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;

      constructor() {
        control.instances.push(this);
      }

      start() {
        this.startCalls += 1;
      }

      stop() {}

      abort() {}

      emitAudioStart() {
        this.onaudiostart?.(new Event('audiostart'));
      }

      emitResult(transcript: string) {
        const alternative = { transcript, confidence: 0.9 };
        const result = Object.assign([alternative], {
          isFinal: true,
          item: (index: number) => (index === 0 ? alternative : null),
        });
        const results = Object.assign([result], {
          item: (index: number) => (index === 0 ? result : null),
        });
        const event = Object.assign(new Event('result'), { resultIndex: 0, results });
        this.onresult?.(event);
      }
    }

    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      writable: true,
      value: FakeSpeechRecognition,
    });
    window.__voiceTestControl = control;
  });
}

async function createVoiceCatalog(
  request: Parameters<typeof personalLedger>[0],
  token: string,
): Promise<void> {
  const personal = await personalLedger(request, token);
  const accounts = await listAccounts(request, token);
  if (!accounts.some((account) => account.name === '現金' && !account.isTemporary)) {
    throw new Error('測試帳號缺少預設的「現金」帳戶。');
  }
  await createAccount(request, token, { name: '信用卡' });
  await createCategory(request, token, personal.id, { name: '早餐', type: 'EXPENSE' });
  await createCategory(request, token, personal.id, { name: '午餐', type: 'EXPENSE' });
}

function watchAiRequests(page: import('@playwright/test').Page) {
  let parseRequests = 0;
  let transactionPosts = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/api/ai/parse-transaction')) {
      parseRequests += 1;
    }
    if (request.method() === 'POST' && /\/api\/ledgers\/[^/]+\/transactions$/.test(url.pathname)) {
      transactionPosts += 1;
    }
  });
  return {
    parseRequests: () => parseRequests,
    transactionPosts: () => transactionPosts,
  };
}

/** SC-SR13 驗證瀏覽器事件與解析請求邊界；Playwright 使用設定中的 fake LLM。 */
test.describe('AI voice entry', () => {
  test('SC-SR13 (1)：final 只填文字，按送出後解析並產生草稿', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    await createVoiceCatalog(request, userA.token);
    const requests = watchAiRequests(page);
    await installFakeRecognition(page);
    await page.reload();
    await openTransactions(page);

    await page.getByRole('button', { name: '開始語音記帳' }).click();
    await page.evaluate(() => window.__voiceTestControl?.emitAudioStart(0));
    await expect(page.getByRole('status')).toHaveText('聆聽中…');
    await page.evaluate((text) => window.__voiceTestControl?.emitResult(0, text), VOICE_TEXT);

    const input = page.getByRole('textbox', { name: '用一句話記帳' });
    await expect(input).toHaveValue(VOICE_TEXT);
    expect(requests.parseRequests()).toBe(0);

    await page.getByRole('button', { name: '送出', exact: true }).click();
    await expect(page.getByRole('button', { name: '確認草稿：早餐', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '確認草稿：午餐', exact: true })).toBeVisible();
    expect(requests.parseRequests()).toBe(1);
    expect(requests.transactionPosts()).toBe(0);
  });

  test('SC-SR13 (2)：取消後送來的舊 final 不填入也不解析', async ({
    signedInPage: page,
    userA,
    request,
  }) => {
    await createVoiceCatalog(request, userA.token);
    const requests = watchAiRequests(page);
    await installFakeRecognition(page);
    await page.reload();
    await openTransactions(page);

    await page.getByRole('button', { name: '開始語音記帳' }).click();
    await page.evaluate(() => window.__voiceTestControl?.emitAudioStart(0));
    await expect(page.getByRole('status')).toHaveText('聆聽中…');
    await page.getByRole('button', { name: '取消語音' }).click();
    await page.evaluate((text) => window.__voiceTestControl?.emitResult(0, text), VOICE_TEXT);

    await expect(page.getByRole('textbox', { name: '用一句話記帳' })).toHaveValue('');
    expect(requests.parseRequests()).toBe(0);
  });

  test('SC-SR13 (3)：沒有可用辨識建構子時不顯示麥克風按鈕', async ({ signedInPage: page }) => {
    const requests = watchAiRequests(page);
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'SpeechRecognition');
      Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    });
    await page.reload();
    await openTransactions(page);

    await expect(page.getByRole('button', { name: '開始語音記帳' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AI 記帳', exact: true })).toBeVisible();
    expect(requests.parseRequests()).toBe(0);
  });
});
