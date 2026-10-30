import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParseTransactionResponse } from '@ledger/shared';
import { AI_TEXT_MAX_LENGTH } from '@ledger/shared';
import type { AiDraftItem } from './AiDraftList';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { PageToolbarSlotProvider } from '../../app/PageToolbarSlotProvider';
import { AiEntry } from './AiEntry';
import styles from './AiEntry.module.css';
import { AiSessionProvider, useAiSession } from './ai-session';
import {
  installFakeSpeechRecognition,
  type FakeSpeechRecognition,
  type FakeSpeechRecognitionController,
} from './test-support/fake-speech-recognition';

const mocks = vi.hoisted(() => ({
  token: 'token-a',
  userId: 'user-a',
  authenticated: true,
  parse: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('../auth/use-auth', () => ({
  useAuth: () => ({
    token: mocks.authenticated ? mocks.token : null,
    isAuthenticated: mocks.authenticated,
  }),
}));
vi.mock('../auth/use-current-user', () => ({
  useCurrentUser: () => ({
    data: mocks.authenticated ? { id: mocks.userId } : undefined,
  }),
}));
vi.mock('../transactions/use-transactions', () => ({
  useCreateTransactionForLedger: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock('./use-ai-parse', () => ({ useAiParse: () => ({ parse: mocks.parse }) }));

const ledger = {
  id: 'ledger-a',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
} as const;
const sentence = '早餐 60 現金';

const probe: {
  text: string;
  setText: (text: string) => void;
  drafts: readonly AiDraftItem[];
  confirmDraft: (key: string) => Promise<boolean>;
} = {
  text: '',
  setText: () => undefined,
  drafts: [],
  confirmDraft: () => Promise.resolve(false),
};

let speech: FakeSpeechRecognitionController | null = null;

function SessionProbe() {
  const { confirmDraft, drafts, setText, text } = useAiSession();
  useLayoutEffect(() => {
    probe.text = text;
    probe.setText = setText;
    probe.drafts = drafts;
    probe.confirmDraft = confirmDraft;
  }, [confirmDraft, drafts, setText, text]);
  return null;
}

function ToolbarSlot() {
  const { setElement } = usePageToolbarSlot();
  return <div ref={setElement} data-testid="page-toolbar-slot" />;
}

function EntryHarness(props: Partial<ComponentProps<typeof AiEntry>>) {
  return (
    <AiSessionProvider>
      <SessionProbe />
      <PageToolbarSlotProvider>
        <ToolbarSlot />
        <AiEntry ledger={ledger} {...props} />
      </PageToolbarSlotProvider>
    </AiSessionProvider>
  );
}

function renderEntry(props: Partial<ComponentProps<typeof AiEntry>> = {}) {
  return render(EntryHarness(props));
}

function inputBox() {
  return screen.getByRole('textbox', { name: '用一句話記帳', hidden: true });
}

function readAiEntryCss(): string {
  return readFileSync(join(process.cwd(), 'src/features/ai/AiEntry.module.css'), 'utf8');
}

function expectNoParseWithInput(value: string) {
  expect(mocks.parse).not.toHaveBeenCalled();
  expect(inputBox()).toHaveValue(value);
  expect(probe.text).toBe(value);
}

function expectSingleParse(text: string, ledgerId: string = ledger.id) {
  expect(mocks.parse).toHaveBeenCalledTimes(1);
  const request: unknown = mocks.parse.mock.calls[0]?.[0];
  expect(request).toMatchObject({ text, ledgerId });
  expect(typeof (request as { today?: unknown }).today).toBe('string');
}

async function startRound(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '開始語音記帳' }));
  const recognition = speech!.latest();
  expect(recognition.startCalls).toBe(1);
  return recognition;
}

async function startListening(user: ReturnType<typeof userEvent.setup>) {
  const recognition = await startRound(user);
  act(() => {
    recognition.emitStart();
    recognition.emitAudioStart();
  });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('聆聽中…'));
  return recognition;
}

function emitFinal(recognition: FakeSpeechRecognition, transcript = sentence) {
  act(() => recognition.emitResult(transcript, { isFinal: true }));
}

/** rAF 與時鐘都由測試推進，取消後仍可故意呼叫舊回呼，驗證世代隔離。 */
function manualRaf() {
  let now = 0;
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextId;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    pending.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    pending,
    request,
    cancel,
    step(milliseconds: number) {
      act(() => {
        now += milliseconds;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((callback) => callback(now));
      });
    },
    stale(callbacks: FrameRequestCallback[]) {
      act(() => callbacks.forEach((callback) => callback(now + 5000)));
    },
  };
}

function glyphPaths(button: HTMLElement): string[] {
  const paths = [...button.querySelectorAll('path[data-particle]')];
  expect(paths.map((path) => path.getAttribute('data-particle'))).toEqual([
    'left',
    'top',
    'right',
    'bottom',
    'center',
  ]);
  return paths.map((path) => path.getAttribute('d')!);
}

const STATIC_DOTS = [
  'M4,12L4,12.000001A0,0 0 0 0 4,12.000001L4,12.000001A0,0 0 0 0 4,12.000001',
  'M12,4L12,4.000001A0,0 0 0 0 12,4.000001L12,4.000001A0,0 0 0 0 12,4.000001',
  'M20,12L20,12.000001A0,0 0 0 0 20,12.000001L20,12.000001A0,0 0 0 0 20,12.000001',
  'M12,20L12,20.000001A0,0 0 0 0 12,20.000001L12,20.000001A0,0 0 0 0 12,20.000001',
  'M12,12L12,12.000001A0,0 0 0 1 12,12.000001L12,12.000001A0,0 0 0 1 12,12.000001',
];
const STATIC_BARS = [
  'M16,6.9L16,17.1A0,0 0 0 0 16,17.1L16,17.1A0,0 0 0 0 16,17.1',
  'M20,9.9L20,14.1A0,0 0 0 0 20,14.1L20,14.1A0,0 0 0 0 20,14.1',
  'M8,6.9L8,17.1A0,0 0 0 0 8,17.1L8,17.1A0,0 0 0 0 8,17.1',
  'M4,9.9L4,14.1A0,0 0 0 0 4,14.1L4,14.1A0,0 0 0 0 4,14.1',
  'M12,3.9L12,20.1A0,0 0 0 1 12,20.1L12,20.1A0,0 0 0 1 12,20.1',
];

/** 以可控制的假辨識器驗證語音辨識只填入文字，解析仍只由送出按鈕觸發。 */
describe('AI entry voice input', () => {
  beforeEach(() => {
    mocks.token = 'token-a';
    mocks.userId = 'user-a';
    mocks.authenticated = true;
    mocks.parse.mockReset().mockResolvedValue({ drafts: [] } satisfies ParseTransactionResponse);
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
    probe.text = '';
    probe.drafts = [];
    speech = null;
  });

  afterEach(() => {
    speech?.uninstall();
    speech = null;
    delete document.documentElement.dataset.motion;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('SC-SR1 (1)：沒有建構子時不顯示麥克風，打字仍可用', async () => {
    const user = userEvent.setup();
    renderEntry();

    expect(screen.queryByRole('button', { name: '開始語音記帳' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    expectNoParseWithInput(sentence);
  });

  it('SC-SR1 (2)：只有 webkit 建構子時顯示按鈕並用它建立辨識器', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    const recognition = await startRound(user);
    expect(recognition.constructedFrom).toBe('webkitSpeechRecognition');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR1 (3)：標準建構子優先於 webkit 建構子', async () => {
    speech = installFakeSpeechRecognition({ global: 'both' });
    const user = userEvent.setup();
    renderEntry();

    const recognition = await startRound(user);
    expect(recognition.constructedFrom).toBe('SpeechRecognition');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR1 (4)：非安全環境不顯示麥克風', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition', secure: false });
    const user = userEvent.setup();
    renderEntry();

    expect(screen.queryByRole('button', { name: '開始語音記帳' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    expectNoParseWithInput(sentence);
    expect(speech.instances).toHaveLength(0);
  });

  it.each([
    ['載入中的帳本清單', { isLedgerLoading: true }],
    ['帳本清單錯誤', { ledgerError: new Error('private detail') }],
    ['沒有帳本', { ledger: undefined }],
  ])('SC-SR1 (5)：%s 時不顯示或啟動辨識', (_name, props) => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry(props);

    expect(screen.queryByRole('button', { name: '開始語音記帳' })).not.toBeInTheDocument();
    expect(speech.instances).toHaveLength(0);
    expect(probe.text).toBe('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR1 (6)：載入頁面和展開入口都不會自動 start', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    expect(speech.instances).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    expect(speech.instances).toHaveLength(0);
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR1 (5)：檢視者可聚焦麥克風但不能開始', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry({ ledger: { ...ledger, role: 'VIEWER' } });

    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    expect(microphone).toHaveAttribute('aria-disabled', 'true');
    expect(microphone).not.toBeDisabled();
    expect(screen.getByRole('tooltip')).toHaveTextContent('只能檢視');
    await user.click(microphone);
    expect(speech.instances).toHaveLength(0);
    expect(probe.text).toBe('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR1 (5)：輸入欄有文字時麥克風停用', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeDisabled();
    expectNoParseWithInput(sentence);
  });

  it('SC-SR2：設定辨識參數，且每輪建立新的實例', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    const first = await startListening(user);
    expect(first).toMatchObject({
      lang: 'zh-TW',
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
    emitFinal(first);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    await user.clear(inputBox());
    const second = await startRound(user);

    expect(second).not.toBe(first);
    expect(speech.instances).toHaveLength(2);
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR3 (1)：final 填入輸入欄並將焦點移到文字末端，不解析', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    const recognition = await startListening(user);
    emitFinal(recognition);

    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    expect(inputBox()).toHaveFocus();
    expect((inputBox() as HTMLInputElement).selectionStart).toBe(sentence.length);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR3 (5)：語音填入後在中間插字時保留游標位置', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));

    const input = inputBox() as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 2);
    await user.keyboard('XY');

    expect(input).toHaveValue('早餐XY 60 現金');
    expect(input.selectionStart).toBe(4);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR3 (2)：只有使用者按送出才解析，接著照既有流程清空輸入', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    mocks.parse.mockResolvedValueOnce({
      drafts: [
        {
          ledgerId: ledger.id,
          type: 'EXPENSE',
          amount: 6000,
          date: '2026-10-29',
          title: '早餐',
          categoryId: 'category-1',
          newCategoryName: null,
          accountId: 'account-1',
          toAccountId: null,
        },
      ],
    } satisfies ParseTransactionResponse);
    const user = userEvent.setup();
    renderEntry();

    const recognition = await startListening(user);
    emitFinal(recognition);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    expect(mocks.parse).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(inputBox()).toHaveValue(''));
    expectSingleParse(sentence);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('SC-SR3 (3)、(4)：送出修改後的文字，按清除鈕後能再錄一輪', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();

    const recognition = await startListening(user);
    emitFinal(recognition);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    await user.clear(inputBox());
    await user.type(inputBox(), '早餐 80 現金');
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    expectSingleParse('早餐 80 現金');
    await waitFor(() => expect(inputBox()).toHaveValue('早餐 80 現金'));
    expect(probe.text).toBe('早餐 80 現金');
    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));
    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '開始語音記帳' }));
    expect(speech.instances).toHaveLength(2);
    expect(speech.latest().startCalls).toBe(1);
  });

  it('SC-SR17 (1)：一般文字可以清除並恢復語音按鈕', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), '早餐 60 現金');

    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));

    expect(inputBox()).toHaveValue('');
    expect(probe.text).toBe('');
    expect(inputBox()).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeEnabled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('SC-SR17 (1)：只有空白時仍顯示清除鈕，清除後可用麥克風', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    fireEvent.change(inputBox(), { target: { value: '   ' } });
    const clearButton = screen.getByRole('button', { name: '清除輸入文字' });

    expect(clearButton).toHaveAttribute('type', 'button');
    expect(clearButton.querySelector('span')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeEnabled();
    await user.click(clearButton);

    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeEnabled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR17 (1)：清除同時移除字數、語音與解析錯誤', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    mocks.parse.mockRejectedValueOnce(new Error('provider detail'));
    const user = userEvent.setup();
    renderEntry();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI 暫時沒有回應，請稍後再試。'),
    );

    await user.clear(inputBox());
    expect(screen.getByRole('alert')).toHaveTextContent('AI 暫時沒有回應，請稍後再試。');
    const recognition = await startRound(user);
    emitFinal(recognition, 'a'.repeat(AI_TEXT_MAX_LENGTH + 1));
    await waitFor(() => expect(inputBox()).toHaveValue('a'.repeat(AI_TEXT_MAX_LENGTH + 1)));
    expect(screen.getByRole('alert')).toHaveTextContent('請精簡至 200 字內。');

    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));

    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開始語音記帳' })).toBeEnabled();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('SC-SR17 (1)：送出解析失敗後按清除鈕清空文字與錯誤', async () => {
    mocks.parse.mockRejectedValueOnce(new Error('provider detail'));
    const user = userEvent.setup();
    renderEntry();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI 暫時沒有回應，請稍後再試。'),
    );

    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));

    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it('SC-SR17 (2)：清除輸入不影響草稿、草稿錯誤與 API 請求數', async () => {
    mocks.parse.mockResolvedValueOnce({
      drafts: [
        {
          ledgerId: ledger.id,
          type: 'EXPENSE',
          amount: 6000,
          date: '2026-10-29',
          title: '早餐',
          categoryId: 'category-1',
          newCategoryName: null,
          accountId: 'account-1',
          toAccountId: null,
        },
      ],
    } satisfies ParseTransactionResponse);
    mocks.mutateAsync.mockRejectedValueOnce(new Error('provider detail'));
    const user = userEvent.setup();
    renderEntry();
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), sentence);
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(probe.drafts).toHaveLength(1));

    await act(async () => {
      await probe.confirmDraft(probe.drafts[0]!.key);
    });
    await waitFor(() => expect(probe.drafts[0]?.error).toBe('寫入失敗，請稍後再試。'));
    await user.click(screen.getByRole('button', { name: 'AI 記帳' }));
    await user.type(inputBox(), '午餐 120 刷卡');
    const draftsBeforeClear = probe.drafts;
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));

    expect(probe.drafts).toBe(draftsBeforeClear);
    expect(probe.drafts[0]?.error).toBe('寫入失敗，請稍後再試。');
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(probe.text).toBe('');
  });

  it('SC-SR17 (3)：收合、解析中、辨識中與唯讀狀態不顯示清除鈕', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    const view = renderEntry();
    act(() => probe.setText('保留文字'));
    expect(screen.queryByRole('button', { name: '清除輸入文字' })).not.toBeInTheDocument();
    const clearButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="清除輸入文字"]',
    )!;
    fireEvent.click(clearButton);
    expect(probe.text).toBe('保留文字');

    const toggle = screen.getByRole('button', { name: 'AI 記帳' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: '清除輸入文字' })).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByRole('button', { name: '清除輸入文字' })).not.toBeInTheDocument();
    expect(probe.text).toBe('保留文字');
    fireEvent.click(clearButton);
    expect(probe.text).toBe('保留文字');

    await user.click(toggle);
    let finishParse!: (result: ParseTransactionResponse) => void;
    const pending = new Promise<ParseTransactionResponse>((resolve) => {
      finishParse = resolve;
    });
    mocks.parse.mockReturnValueOnce(pending);
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(screen.queryByRole('button', { name: '清除輸入文字' })).not.toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(inputBox()).toHaveValue('保留文字');
    await act(async () => {
      finishParse({ drafts: [] });
      await pending;
    });

    act(() => probe.setText(''));
    const recognition = await startRound(user);
    expect(screen.queryByRole('button', { name: '清除輸入文字' })).not.toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(screen.getByRole('status')).toHaveTextContent('準備中…');
    expect(recognition.abortCalls).toBe(0);
    expect(screen.getByRole('button', { name: '取消語音' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '取消語音' }));
    expect(recognition.abortCalls).toBe(1);

    act(() => probe.setText('唯讀文字'));
    view.rerender(
      <AiSessionProvider>
        <SessionProbe />
        <PageToolbarSlotProvider>
          <ToolbarSlot />
          <AiEntry ledger={{ ...ledger, role: 'VIEWER' }} />
        </PageToolbarSlotProvider>
      </AiSessionProvider>,
    );
    expect(inputBox()).toHaveValue('唯讀文字');
    expect(screen.queryByRole('button', { name: '清除輸入文字' })).not.toBeInTheDocument();
    fireEvent.click(clearButton);
    expect(inputBox()).toHaveValue('唯讀文字');
  });

  it('SC-SR17 (4)：兩個入口共用文字與解析錯誤，任一處清除都同步生效', async () => {
    mocks.parse.mockRejectedValueOnce(new Error('provider detail'));
    const user = userEvent.setup();
    render(
      <AiSessionProvider>
        <SessionProbe />
        <PageToolbarSlotProvider>
          <ToolbarSlot />
          <AiEntry ledger={ledger} />
          <AiEntry ledger={ledger} />
        </PageToolbarSlotProvider>
      </AiSessionProvider>,
    );
    const inputs = screen.getAllByRole('textbox', { name: '用一句話記帳', hidden: true });
    const [firstToggle] = screen.getAllByRole('button', { name: 'AI 記帳' });
    await user.click(firstToggle!);
    await user.type(inputs[0]!, sentence);
    const [firstSubmit] = screen.getAllByRole('button', { name: '送出' });
    await user.click(firstSubmit!);
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(inputs[0]).toHaveValue(sentence);
    expect(inputs[1]).toHaveValue(sentence);

    await user.click(screen.getByRole('button', { name: '清除輸入文字' }));

    expect(inputs[0]).toHaveValue('');
    expect(inputs[1]).toHaveValue('');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });

  it.each([
    'final → end',
    '同一輪兩個 final',
    'final → error → end',
    'error → end（交付前）',
    'end 沒有 final',
    '只有 interim 結果',
  ])('SC-SR4：%s 的事件順序最多填入一次且不自動解析', async (caseName) => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);

    act(() => {
      if (caseName === 'final → end') {
        recognition.emitResult(sentence, { isFinal: true });
        recognition.emitEnd();
      } else if (caseName === '同一輪兩個 final') {
        recognition.emitResult(sentence, { isFinal: true });
        recognition.emitResult('午餐 120 刷卡', { isFinal: true });
      } else if (caseName === 'final → error → end') {
        recognition.emitResult(sentence, { isFinal: true });
        recognition.emitError('network');
        recognition.emitEnd();
      } else if (caseName === 'error → end（交付前）') {
        recognition.emitError('network');
        recognition.emitEnd();
      } else if (caseName === 'end 沒有 final') {
        recognition.emitEnd();
      } else {
        recognition.emitResult('說到一半', { isFinal: false });
      }
    });

    if (caseName === '只有 interim 結果') {
      expectNoParseWithInput('');
      await user.click(screen.getByRole('button', { name: '取消語音' }));
    } else if (caseName === 'error → end（交付前）') {
      expectNoParseWithInput('');
      expect(screen.getByRole('alert')).toHaveTextContent('語音服務連線失敗，請再試一次。');
    } else if (caseName === 'end 沒有 final') {
      expectNoParseWithInput('');
      expect(screen.getByRole('alert')).toHaveTextContent('沒聽清楚，請再試一次。');
    } else {
      await waitFor(() => expect(inputBox()).toHaveValue(sentence));
      expect(probe.text).toBe(sentence);
      expect(mocks.parse).not.toHaveBeenCalled();
    }
  });

  it('SC-SR7 (1)：連按兩次取消，第三次開始新一輪', () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });

    fireEvent.click(microphone);
    fireEvent.click(microphone);

    expect(speech.instances).toHaveLength(1);
    expect(speech.latest().startCalls).toBe(1);
    expect(speech.latest().abortCalls).toBe(1);
    expect(speech.latest().stopCalls).toBe(0);
    expect(inputBox()).toHaveValue('');
    expect(probe.text).toBe('');
    expect(mocks.parse).not.toHaveBeenCalled();

    fireEvent.click(microphone);
    expect(speech.instances).toHaveLength(2);
    expect(speech.latest().startCalls).toBe(1);
    expect(speech.latest().abortCalls).toBe(0);
  });

  it('SC-SR7 (2)：start 丟例外時顯示訊息並解除鎖，可再開始', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    speech.setStartError(new Error('provider detail'));
    const user = userEvent.setup();
    renderEntry();

    await user.click(screen.getByRole('button', { name: '開始語音記帳' }));
    expect(screen.getByRole('alert')).toHaveTextContent('目前無法使用語音，請改用文字。');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expectNoParseWithInput('');

    speech.setStartError(null);
    await user.click(screen.getByRole('button', { name: '開始語音記帳' }));
    expect(speech.instances).toHaveLength(2);
    expect(speech.latest().startCalls).toBe(1);
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR8 (1)：聆聽 30 秒後 stop，之後 final 仍可填入', async () => {
    vi.useFakeTimers();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: '開始語音記帳' }));
    const recognition = speech.latest();
    act(() => recognition.emitAudioStart());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(recognition.stopCalls).toBe(1);
    expect(recognition.abortCalls).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('辨識中…');
    emitFinal(recognition);
    expect(inputBox()).toHaveValue(sentence);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR8 (2)：15 秒沒有 audiostart 就 abort 並提示', async () => {
    vi.useFakeTimers();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: '開始語音記帳' }));
    const recognition = speech.latest();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(recognition.abortCalls).toBe(1);
    expect(screen.getByRole('alert')).toHaveTextContent('目前無法使用語音，請改用文字。');
    expectNoParseWithInput('');
  });

  it('SC-SR8 (3)、(4)：audioend 後 10 秒沒 final 取消，舊 timer 不影響下一輪', async () => {
    vi.useFakeTimers();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    fireEvent.click(screen.getByRole('button', { name: '開始語音記帳' }));
    const first = speech.latest();
    act(() => first.emitAudioEnd());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(first.abortCalls).toBe(1);
    expect(screen.getByRole('alert')).toHaveTextContent('沒聽清楚，請再試一次。');
    expectNoParseWithInput('');

    fireEvent.click(screen.getByRole('button', { name: '開始語音記帳' }));
    const second = speech.latest();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(second.abortCalls).toBe(0);
    expect(screen.getByRole('status')).toHaveTextContent('準備中…');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR9 (1)：只有空白的 final 顯示沒聽清楚且不填入', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition, '　  ');

    expectNoParseWithInput('');
    expect(screen.getByRole('alert')).toHaveTextContent('沒聽清楚，請再試一次。');
  });

  it('SC-SR9 (2)：200 個 code point（包含 emoji）可以送出', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const text = `${'字'.repeat(AI_TEXT_MAX_LENGTH - 1)}😀`;
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition, text);
    await waitFor(() => expect(inputBox()).toHaveValue(text));

    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    expectSingleParse(text);
    await waitFor(() => expect(inputBox()).toHaveValue(text));
  });

  it('SC-SR9 (3)：201 個 code point 完整填入但不送出，刪到 200 後可送', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const text = 'a'.repeat(AI_TEXT_MAX_LENGTH + 1);
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition, text);
    await waitFor(() => expect(inputBox()).toHaveValue(text));
    expect(screen.getByRole('alert')).toHaveTextContent('請精簡至 200 字內。');

    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(inputBox()).toHaveValue(text);
    expect(probe.text).toBe(text);

    const input = inputBox() as HTMLInputElement;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    await user.keyboard('{Backspace}');
    const allowedText = 'a'.repeat(AI_TEXT_MAX_LENGTH);
    expect(inputBox()).toHaveValue(allowedText);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    expectSingleParse(allowedText);
    await waitFor(() => expect(inputBox()).toHaveValue(allowedText));
  });

  it('SC-SR9 (4)：解析失敗保留語音文字且不自動重送', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    mocks.parse.mockRejectedValueOnce(new Error('provider detail'));
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    expect(mocks.parse).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '送出' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('AI 暫時沒有回應，請稍後再試。'),
    );
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(inputBox()).toHaveValue(sentence);
    expect(probe.text).toBe(sentence);
  });

  it('SC-SR10：辨識文字跨帳本保留，送出後隱藏入口不取消解析', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    const view = renderEntry();
    const recognition = await startListening(user);
    emitFinal(recognition);
    await waitFor(() => expect(inputBox()).toHaveValue(sentence));
    expect(mocks.parse).not.toHaveBeenCalled();

    view.rerender(
      <AiSessionProvider>
        <SessionProbe />
        <PageToolbarSlotProvider>
          <ToolbarSlot />
          <AiEntry ledger={{ ...ledger, id: 'ledger-b' }} />
        </PageToolbarSlotProvider>
      </AiSessionProvider>,
    );
    expect(inputBox()).toHaveValue(sentence);

    let finishParse!: (result: ParseTransactionResponse) => void;
    const pending = new Promise<ParseTransactionResponse>((resolve) => {
      finishParse = resolve;
    });
    mocks.parse.mockReturnValueOnce(pending);
    await user.click(screen.getByRole('button', { name: '送出' }));
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expectSingleParse(sentence, 'ledger-b');

    view.rerender(
      <AiSessionProvider>
        <SessionProbe />
        <PageToolbarSlotProvider>
          <ToolbarSlot />
          <AiEntry ledger={{ ...ledger, id: 'ledger-b' }} isVisible={false} />
        </PageToolbarSlotProvider>
      </AiSessionProvider>,
    );
    expect(
      screen.queryByRole('textbox', { name: '用一句話記帳', hidden: true }),
    ).not.toBeInTheDocument();
    expect(probe.text).toBe(sentence);
    expect(mocks.parse).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishParse({ drafts: [] });
      await pending;
    });
    expect(probe.text).toBe(sentence);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not-allowed', '無法使用麥克風，請檢查權限。'],
    ['no-speech', '沒聽清楚，請再試一次。'],
    ['nomatch', '沒聽清楚，請再試一次。'],
    ['audio-capture', '無法使用麥克風。'],
    ['network', '語音服務連線失敗，請再試一次。'],
    ['service-not-allowed', '目前無法使用語音，請改用文字。'],
    ['language-not-supported', '目前無法使用語音，請改用文字。'],
    ['aborted', '目前無法使用語音，請改用文字。'],
    ['unknown-code', '目前無法使用語音，請改用文字。'],
  ])('SC-SR11：%s 顯示 spec 對應訊息', async (code, message) => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const recognition = await startListening(user);
    act(() => {
      recognition.emitError(code);
      recognition.emitEnd();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expectNoParseWithInput('');
  });

  it('SC-SR11：新一輪清掉上一輪語音錯誤，自己取消不顯示錯誤', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const first = await startListening(user);
    act(() => first.emitError('network'));
    expect(screen.getByRole('alert')).toHaveTextContent('語音服務連線失敗，請再試一次。');
    expectNoParseWithInput('');

    const second = await startRound(user);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消語音' }));
    act(() => second.emitError('aborted'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expectNoParseWithInput('');
  });

  it('SC-SR11：再按麥克風取消後焦點回到麥克風按鈕', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    await startRound(user);

    await user.click(screen.getByRole('button', { name: '取消語音' }));

    expect(screen.getByRole('button', { name: '開始語音記帳' })).toHaveFocus();
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR12：Enter 與 Space 可開始和取消，Escape 取消並將焦點放回麥克風', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeEmptyDOMElement();
    expect(liveRegion).toHaveClass(styles.visuallyHidden!);

    microphone.focus();
    await user.keyboard('{Enter}');
    const recognition = speech.latest();
    expect(recognition.startCalls).toBe(1);
    expect(screen.getByRole('button', { name: '取消語音' })).toBe(microphone);
    expect(screen.getByRole('status')).toHaveTextContent('準備中…');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();

    act(() => recognition.emitAudioStart());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('聆聽中…'));
    microphone.focus();
    await user.keyboard(' ');
    expect(recognition.abortCalls).toBe(1);
    expect(recognition.stopCalls).toBe(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(microphone).toHaveFocus();
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    const second = speech.latest();
    expect(second).not.toBe(recognition);
    expect(second.startCalls).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('準備中…');
    await user.keyboard('{Escape}');
    expect(second.abortCalls).toBe(1);
    expect(second.stopCalls).toBe(0);
    expect(microphone).toHaveFocus();
    expect(screen.getByRole('button', { name: 'AI 記帳' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await user.keyboard(' ');
    const third = speech.latest();
    expect(third).not.toBe(second);
    expect(third.startCalls).toBe(1);
    await user.keyboard(' ');
    expect(third.abortCalls).toBe(1);
    expect(third.stopCalls).toBe(0);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await user.type(inputBox(), '鍵盤清除');
    let clearButton = screen.getByRole('button', { name: '清除輸入文字' });
    clearButton.focus();
    await user.keyboard('{Enter}');
    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();

    await user.type(inputBox(), '再次清除');
    clearButton = screen.getByRole('button', { name: '清除輸入文字' });
    clearButton.focus();
    await user.keyboard(' ');
    expect(inputBox()).toHaveValue('');
    expect(inputBox()).toHaveFocus();
    expectNoParseWithInput('');
  });

  it('SC-SR18 (1)(2)：實際 SVG 在閒置、等待、收音不同，辨識中持續是五點', () => {
    const raf = manualRaf();
    document.documentElement.dataset.motion = 'off';
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    const idle = glyphPaths(microphone);
    expect(idle[4]).toBe('M15,6L15,12A3,3 0 0 1 9,12L9,6A3,3 0 0 1 15,6');
    const svg = microphone.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveAttribute('height', '20');
    expect(svg).toHaveAttribute('stroke-width', '1.8');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveAttribute('pointer-events', 'none');
    expect(svg).not.toHaveAttribute('role');
    expect(svg.querySelector('title')).toBeNull();
    expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeNull();

    fireEvent.click(microphone);
    const recognition = speech.latest();
    expect(microphone).toHaveAttribute('data-voice-look', 'waiting');
    expect(glyphPaths(microphone)).toEqual(STATIC_DOTS);
    expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeInTheDocument();
    act(() => recognition.emitAudioStart());
    expect(microphone).toHaveAttribute('data-voice-look', 'recording');
    expect(glyphPaths(microphone)).toEqual(STATIC_BARS);
    act(() => recognition.emitAudioEnd());
    expect(microphone).toHaveAttribute('data-voice-look', 'waiting');
    expect(glyphPaths(microphone)).toEqual(STATIC_DOTS);
    raf.step(2000);
    expect(glyphPaths(microphone)).toEqual(STATIC_DOTS);
    expect(raf.request).not.toHaveBeenCalled();
    expectNoParseWithInput('');
    emitFinal(recognition);
    expect(glyphPaths(microphone)).toEqual(idle);
    expect(microphone).toBeDisabled();
    expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeNull();
    expectNoParseWithInput(sentence);
    const css = readAiEntryCss();
    expect(css).not.toMatch(/voice-wait-turn|voice-record-pulse|recordingWaveform|voiceActivity/);
  });

  it('SC-SR18 (3)：狀態文字只在視覺隱藏的 live region 內，閒置時為空', async () => {
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const user = userEvent.setup();
    renderEntry();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeEmptyDOMElement();
    expect(liveRegion).toHaveClass(styles.visuallyHidden!);

    await user.click(screen.getByRole('button', { name: '開始語音記帳' }));
    const recognition = speech.latest();
    await waitFor(() => expect(liveRegion).toHaveTextContent('準備中…'));
    expect(screen.getAllByText('準備中…')).toEqual([liveRegion]);
    expect(liveRegion).toHaveClass(styles.visuallyHidden!);

    act(() => recognition.emitAudioStart());
    await waitFor(() => expect(liveRegion).toHaveTextContent('聆聽中…'));
    expect(screen.getAllByText('聆聽中…')).toEqual([liveRegion]);
    expect(liveRegion).toHaveClass(styles.visuallyHidden!);

    act(() => recognition.emitAudioEnd());
    await waitFor(() => expect(liveRegion).toHaveTextContent('辨識中…'));
    expect(screen.getAllByText('辨識中…')).toEqual([liveRegion]);
    expect(liveRegion).toHaveClass(styles.visuallyHidden!);
  });

  it.each(['preparing', 'listening', 'recognizing'] as const)(
    'SC-SR18 (5)：%s 取消後第一個 commit 可立刻重新開始，不等動畫',
    (cancelState) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });

      fireEvent.click(microphone);
      const recognition = speech.latest();
      if (cancelState === 'listening') {
        act(() => recognition.emitAudioStart());
      } else if (cancelState === 'recognizing') {
        act(() => {
          recognition.emitAudioStart();
          recognition.emitAudioEnd();
        });
      }
      expect(microphone).toHaveAttribute('data-voice-state', cancelState);

      fireEvent.click(microphone);
      expect(microphone).toHaveAttribute('aria-label', '開始語音記帳');
      expect(microphone).toHaveAttribute('data-voice-look', 'idle');
      expect(microphone.querySelector(`.${styles.microphoneIcon!}`)).toBeInTheDocument();
      expect(microphone).not.toBeDisabled();
      expect(recognition.abortCalls).toBe(1);
      expect(recognition.stopCalls).toBe(0);
      expect(microphone).toHaveFocus();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(inputBox()).not.toBeDisabled();
      expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeNull();
      expectNoParseWithInput('');

      fireEvent.click(microphone);
      expect(microphone).toHaveAttribute('aria-label', '取消語音');
      expect(microphone).toHaveAttribute('data-voice-state', 'preparing');
      expect(speech.instances).toHaveLength(2);
      expect(speech.latest().startCalls).toBe(1);
      expect(screen.getByRole('status')).toHaveTextContent('準備中…');
      expect(inputBox()).toBeDisabled();
      expect(raf.pending.size).toBe(1);
      expectNoParseWithInput('');
    },
  );

  it('SC-SR18 (5)：一幀不跑，開始、收音、辨識、final 的語意、焦點與停用都已更新', () => {
    const raf = manualRaf();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    const initial = glyphPaths(microphone);
    const live = screen.getByRole('status');
    const status = (look: string, message: string) => {
      expect(microphone).toHaveAttribute('data-voice-look', look);
      expect(microphone).toHaveAccessibleName(look === 'idle' ? '開始語音記帳' : '取消語音');
      expect(live.textContent).toBe(message);
      expect(microphone).not.toBeDisabled();
      expectNoParseWithInput('');
    };
    fireEvent.click(microphone);
    const recognition = speech.latest();
    status('waiting', '準備中…');
    expect(recognition.startCalls).toBe(1);
    expect(inputBox()).toBeDisabled();
    expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeInTheDocument();
    act(() => recognition.emitAudioStart());
    status('recording', '聆聽中…');
    act(() => recognition.emitAudioEnd());
    status('waiting', '辨識中…');
    expect(recognition.abortCalls).toBe(0);
    emitFinal(recognition);
    expect(microphone).toHaveAttribute('data-voice-look', 'idle');
    expect(microphone).toHaveAccessibleName('開始語音記帳');
    expect(live).toBeEmptyDOMElement();
    expect(inputBox()).toHaveFocus();
    expect(inputBox()).not.toBeDisabled();
    expect(microphone).toBeDisabled();
    expect(microphone.querySelector('svg.' + styles.cancelMark)).toBeNull();
    expect(glyphPaths(microphone)).toEqual(initial);
    expectNoParseWithInput(sentence);
    expect(recognition.startCalls).toBe(1);
    expect(recognition.abortCalls).toBe(0);
    expect(raf.pending.size).toBe(0);
  });

  it.each([0.2, 0.5, 0.8])(
    'SC-SR18 (6)：%s 處拆解收到 audiostart，保留實際 SVG 所有筆畫',
    (fraction) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });
      fireEvent.click(microphone);
      const recognition = speech.latest();
      raf.step(500 * fraction);
      const before = glyphPaths(microphone);
      const stale = [...raf.pending.values()];
      act(() => recognition.emitAudioStart());
      expect(glyphPaths(microphone)).toEqual(before);
      raf.step(16);
      const next = glyphPaths(microphone);
      expect(next).not.toEqual(before);
      const scheduled = raf.request.mock.calls.length;
      raf.stale(stale);
      expect(glyphPaths(microphone)).toEqual(next);
      expect(raf.request).toHaveBeenCalledTimes(scheduled);
      expect(raf.pending.size).toBe(1);
      raf.step(684);
      expect(glyphPaths(microphone)).toEqual(STATIC_BARS);
      expect(recognition.startCalls).toBe(1);
      expect(recognition.abortCalls).toBe(0);
      expectNoParseWithInput('');
    },
  );

  it.each([0.2, 0.5, 0.8])('SC-SR18 (6)：%s 處落點中取消，新轉場從實際 SVG 接續', (fraction) => {
    const raf = manualRaf();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    const idle = glyphPaths(microphone);
    fireEvent.click(microphone);
    const recognition = speech.latest();
    raf.step(500);
    act(() => recognition.emitAudioStart());
    raf.step(700 * fraction);
    const before = glyphPaths(microphone);
    const stale = [...raf.pending.values()];
    fireEvent.click(microphone);
    expect(glyphPaths(microphone)).toEqual(before);
    expect(microphone).toHaveFocus();
    expect(recognition.abortCalls).toBe(1);
    raf.step(16);
    const next = glyphPaths(microphone);
    expect(next).not.toEqual(before);
    const scheduled = raf.request.mock.calls.length;
    raf.stale(stale);
    expect(glyphPaths(microphone)).toEqual(next);
    expect(raf.request).toHaveBeenCalledTimes(scheduled);
    raf.step(884);
    expect(glyphPaths(microphone)).toEqual(idle);
    expect(raf.pending.size).toBe(0);
    expectNoParseWithInput('');
  });

  it.each([0.2, 0.5, 0.8])(
    'SC-SR18 (6)：%s 處合併中按第 3 下，從實際 SVG 開始新一輪',
    (fraction) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });
      fireEvent.click(microphone);
      const first = speech.latest();
      raf.step(500);
      act(() => first.emitAudioStart());
      raf.step(700);
      fireEvent.click(microphone);
      raf.step(900 * fraction);
      const before = glyphPaths(microphone);
      const stale = [...raf.pending.values()];
      fireEvent.click(microphone);
      expect(glyphPaths(microphone)).toEqual(before);
      const second = speech.latest();
      expect(second).not.toBe(first);
      expect(first.abortCalls).toBe(1);
      expect(second.startCalls).toBe(1);
      expect(microphone).toHaveAttribute('data-voice-look', 'waiting');
      raf.step(16);
      const next = glyphPaths(microphone);
      expect(next).not.toEqual(before);
      const scheduled = raf.request.mock.calls.length;
      raf.stale(stale);
      expect(glyphPaths(microphone)).toEqual(next);
      expect(raf.request).toHaveBeenCalledTimes(scheduled);
      expect(raf.pending.size).toBe(1);
      raf.step(700);
      expect(glyphPaths(microphone).every((path) => path.includes('A0,0'))).toBe(true);
      expectNoParseWithInput('');
    },
  );

  it.each([0.2, 0.5, 0.8])(
    'SC-SR18 (6)：%s 處收音中 audioend 隨即 final，不等待回外圈',
    (fraction) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });
      const idle = glyphPaths(microphone);
      fireEvent.click(microphone);
      const recognition = speech.latest();
      raf.step(500);
      act(() => recognition.emitAudioStart());
      raf.step(700);
      raf.step(1000 * fraction);
      const before = glyphPaths(microphone);
      const stale = [...raf.pending.values()];
      act(() => recognition.emitAudioEnd());
      expect(glyphPaths(microphone)).toEqual(before);
      stale.push(...raf.pending.values());
      emitFinal(recognition);
      expect(glyphPaths(microphone)).toEqual(before);
      expect(inputBox()).toHaveFocus();
      expect(microphone).toBeDisabled();
      expectNoParseWithInput(sentence);
      raf.step(16);
      const next = glyphPaths(microphone);
      expect(next).not.toEqual(before);
      const scheduled = raf.request.mock.calls.length;
      raf.stale(stale);
      expect(glyphPaths(microphone)).toEqual(next);
      expect(raf.request).toHaveBeenCalledTimes(scheduled);
      raf.step(884);
      expect(glyphPaths(microphone)).toEqual(idle);
      expect(raf.pending.size).toBe(0);
      expect(recognition.abortCalls).toBe(0);
      expectNoParseWithInput(sentence);
    },
  );

  it('SC-SR18 (6)：重複 render 同一個目標不重排或重啟轉場', () => {
    const raf = manualRaf();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    const view = renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    fireEvent.click(microphone);
    raf.step(250);
    const before = glyphPaths(microphone);
    const scheduled = raf.request.mock.calls.length;
    const cancelled = raf.cancel.mock.calls.length;
    view.rerender(EntryHarness({}));
    expect(glyphPaths(microphone)).toEqual(before);
    expect(raf.request).toHaveBeenCalledTimes(scheduled);
    expect(raf.cancel).toHaveBeenCalledTimes(cancelled);
    raf.step(250);
    expect(glyphPaths(microphone).every((path) => path.includes('A0,0'))).toBe(true);
    expect(raf.pending.size).toBe(1);
    expectNoParseWithInput('');
  });

  it.each(['idle', 'preparing', 'listening', 'recognizing'] as const)(
    'SC-SR18 (7)：%s on→off 取消幀，舊回呼無效，off→on 只恢復目前狀態',
    async (state) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });
      const idle = glyphPaths(microphone);
      if (state !== 'idle') {
        fireEvent.click(microphone);
        raf.step(250);
        if (state === 'listening' || state === 'recognizing') {
          act(() => speech!.latest().emitAudioStart());
          raf.step(350);
        }
        if (state === 'recognizing') {
          act(() => speech!.latest().emitAudioEnd());
          raf.step(350);
        }
      }
      const oldCallbacks = [...raf.pending.values()];
      await act(async () => {
        document.documentElement.dataset.motion = 'off';
        await Promise.resolve();
      });
      const still = state === 'idle' ? idle : state === 'listening' ? STATIC_BARS : STATIC_DOTS;
      expect(glyphPaths(microphone)).toEqual(still);
      expect(raf.pending.size).toBe(0);
      if (state !== 'idle') expect(raf.cancel).toHaveBeenCalled();
      const scheduled = raf.request.mock.calls.length;
      raf.stale(oldCallbacks);
      expect(glyphPaths(microphone)).toEqual(still);
      expect(raf.request).toHaveBeenCalledTimes(scheduled);
      raf.step(2000);
      expect(glyphPaths(microphone)).toEqual(still);
      await act(async () => {
        delete document.documentElement.dataset.motion;
        await Promise.resolve();
      });
      expect(glyphPaths(microphone)).toEqual(still);
      expect(raf.pending.size).toBe(state === 'idle' ? 0 : 1);
      raf.step(16);
      if (state !== 'idle') expect(glyphPaths(microphone)).not.toEqual(still);
      else expect(glyphPaths(microphone)).toEqual(still);
      expect(microphone).toHaveAttribute('data-voice-state', state);
      expectNoParseWithInput('');
    },
  );

  it('SC-SR18 (7)：辨識中持續繞圈，沒有計時後合回麥克風', () => {
    const raf = manualRaf();
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    renderEntry();
    const microphone = screen.getByRole('button', { name: '開始語音記帳' });
    fireEvent.click(microphone);
    act(() => speech!.latest().emitAudioStart());
    raf.step(700);
    act(() => speech!.latest().emitAudioEnd());
    raf.step(700);
    const dots = glyphPaths(microphone);
    raf.step(3300);
    expect(glyphPaths(microphone)).not.toEqual(dots);
    expect(glyphPaths(microphone).every((path) => path.includes('A0,0'))).toBe(true);
    expect(microphone).toHaveAttribute('data-voice-state', 'recognizing');
    expect(raf.pending.size).toBe(1);
    expectNoParseWithInput('');
  });

  it.each(['unmount', 'hidden', 'strict'] as const)(
    'SC-SR18 (7)：%s 清除幀與觀察器，同時最多一個 loop',
    async (mode) => {
      const raf = manualRaf();
      speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      const view =
        mode === 'strict'
          ? render(
              <StrictMode>
                <EntryHarness />
              </StrictMode>,
            )
          : renderEntry();
      const microphone = screen.getByRole('button', { name: '開始語音記帳' });
      fireEvent.click(microphone);
      for (let frame = 0; frame < 5; frame += 1) {
        expect(raf.pending.size).toBe(1);
        raf.step(100);
      }
      const stale = [...raf.pending.values()];
      if (mode === 'hidden') view.rerender(EntryHarness({ isVisible: false }));
      else view.unmount();
      expect(raf.pending.size).toBe(0);
      expect(disconnect.mock.calls.length).toBe(observe.mock.calls.length);
      const scheduled = raf.request.mock.calls.length;
      raf.stale(stale);
      await act(async () => {
        document.documentElement.dataset.motion = 'off';
        await Promise.resolve();
      });
      await act(async () => {
        delete document.documentElement.dataset.motion;
        await Promise.resolve();
      });
      expect(raf.request).toHaveBeenCalledTimes(scheduled);
      expect(raf.pending.size).toBe(0);
      expect(speech.latest().abortCalls).toBe(1);
      expect(mocks.parse).not.toHaveBeenCalled();
      expect(probe.text).toBe('');
      expect(screen.queryByRole('textbox', { name: '用一句話記帳', hidden: true })).toBeNull();
    },
  );
});
