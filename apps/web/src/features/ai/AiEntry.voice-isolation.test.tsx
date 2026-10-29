import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { usePageToolbarSlot } from '../../app/PageToolbarSlotContext';
import { PageToolbarSlotProvider } from '../../app/PageToolbarSlotProvider';
import { AiEntry } from './AiEntry';
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

const ledgerA = {
  id: 'ledger-a',
  name: '日常',
  currency: 'TWD',
  kind: 'PERSONAL',
  archivedAt: null,
  role: 'OWNER',
  createdAt: '2026-10-01T00:00:00.000Z',
} as const;
const ledgerB = { ...ledgerA, id: 'ledger-b', name: '旅行' } as const;

const SENTENCE = '早餐 60 現金';

/** 從 AI session 外部讀寫輸入欄文字；輸入欄被隱藏或卸載時仍讀得到 session 的值。 */
const probe: { text: string; setText: (text: string) => void } = {
  text: '',
  setText: () => undefined,
};

function SessionProbe() {
  const { setText, text } = useAiSession();
  useLayoutEffect(() => {
    probe.text = text;
    probe.setText = setText;
  }, [setText, text]);
  return null;
}

function ToolbarSlot() {
  const { setElement } = usePageToolbarSlot();
  return <div ref={setElement} data-testid="page-toolbar-slot" />;
}

interface TreeOptions {
  entryProps?: Partial<ComponentProps<typeof AiEntry>>;
  showEntry?: boolean;
}

/** `showEntry=false` 模擬離開頁面：入口卸載，但路由外層的 AI session 還在（決策 352）。 */
function Tree({ entryProps = {}, showEntry = true }: TreeOptions) {
  return (
    <AiSessionProvider>
      <SessionProbe />
      <PageToolbarSlotProvider>
        <ToolbarSlot />
        {showEntry && <AiEntry ledger={ledgerA} {...entryProps} />}
      </PageToolbarSlotProvider>
    </AiSessionProvider>
  );
}

function renderVoice(strict: boolean, options: TreeOptions = {}) {
  const wrap = (tree: TreeOptions) =>
    strict ? (
      <StrictMode>
        <Tree {...tree} />
      </StrictMode>
    ) : (
      <Tree {...tree} />
    );
  const result = render(wrap(options));
  return { ...result, rerenderTree: (next: TreeOptions) => result.rerender(wrap(next)) };
}

function micButton(name: '開始語音記帳' | '停止聆聽') {
  return screen.getByRole('button', { name });
}

function inputBox() {
  return screen.getByRole('textbox', { name: '用一句話記帳', hidden: true });
}

function alerts() {
  return screen.queryAllByRole('alert', { hidden: true });
}

/** 按麥克風，並讓假辨識器走到「聆聽中」（`start` → `audiostart`）。 */
async function startListening(
  user: ReturnType<typeof userEvent.setup>,
  speech: FakeSpeechRecognitionController,
): Promise<FakeSpeechRecognition> {
  await user.click(micButton('開始語音記帳'));
  const recognition = speech.latest();
  expect(recognition.startCalls).toBe(1);
  act(() => {
    recognition.emitStart();
    recognition.emitAudioStart();
  });
  await waitFor(() => expect(micButton('停止聆聽')).toBeInTheDocument());
  return recognition;
}

/** 已取消的舊實例把瀏覽器可能晚送的事件全部送一遍。 */
function emitLateEvents(recognition: FakeSpeechRecognition) {
  act(() => {
    recognition.emitResult(SENTENCE, { isFinal: true });
    recognition.emitError('aborted');
    recognition.emitError('network');
    recognition.emitEnd();
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  Object.defineProperty(document, 'hidden', { configurable: true, value: state === 'hidden' });
}

interface CancelContext {
  user: ReturnType<typeof userEvent.setup>;
  rerenderTree: (next: TreeOptions) => void;
}

/**
 * 假設 6 的取消條件（SC-SR5 第 2 項；`isVisible=false` 與卸載同時是 SC-SR6 第 4、5 項）。
 * 「開新的一輪」不在表內：辨識中不能開始新的一輪（決策 348 (b)），所以它一定接在
 * 某個取消之後，由 SC-SR5 第 3 項另外測。
 */
const cancelConditions: [string, (context: CancelContext) => Promise<void> | void][] = [
  [
    '按「取消語音」',
    async ({ user }) => user.click(screen.getByRole('button', { name: '取消語音' })),
  ],
  ['辨識期間按 Escape', () => void fireEvent.keyDown(micButton('停止聆聽'), { key: 'Escape' })],
  [
    '按星芒按鈕收合',
    async ({ user }) => user.click(screen.getByRole('button', { name: 'AI 記帳' })),
  ],
  [
    '入口隱藏（isVisible=false）',
    ({ rerenderTree }) => rerenderTree({ entryProps: { isVisible: false } }),
  ],
  ['切帳本', ({ rerenderTree }) => rerenderTree({ entryProps: { ledger: ledgerB } })],
  ['離開頁面（入口卸載）', ({ rerenderTree }) => rerenderTree({ showEntry: false })],
  [
    '登出',
    ({ rerenderTree }) => {
      mocks.authenticated = false;
      rerenderTree({});
    },
  ],
  [
    '換使用者',
    ({ rerenderTree }) => {
      mocks.userId = 'user-b';
      rerenderTree({});
    },
  ],
  [
    '分頁切到背景',
    () => {
      setVisibility('hidden');
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
    },
  ],
];

/**
 * 驗證語音辨識的「停止、取消與有效性」（spec `phase-4a-voice.md` SC-SR5、SC-SR6）。
 *
 * 這是資料隔離的防線：舊的辨識結果不能套到別的身分、別的帳本，或已經被改過的輸入欄。
 * 策略是用假辨識器手動送事件，模擬「取消之後舊實例才送來 result、error、end」，再從
 * AI session 讀輸入欄文字。只透過畫面操作與按鈕名稱（W259），不綁 hook 的內部 API。
 * 每一條都斷言解析次數：語音流程本身一律 0 次（決策 349 (b)）。
 */
describe('AI entry voice isolation', () => {
  let speech: FakeSpeechRecognitionController;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    mocks.token = 'token-a';
    mocks.userId = 'user-a';
    mocks.authenticated = true;
    mocks.parse.mockReset();
    mocks.mutateAsync.mockReset().mockResolvedValue(undefined);
    probe.text = '';
    setVisibility('visible');
    speech = installFakeSpeechRecognition({ global: 'webkitSpeechRecognition' });
    consoleError = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    consoleError.mockRestore();
    speech.uninstall();
    setVisibility('visible');
  });

  describe.each([
    ['', false],
    ['（StrictMode）', true],
  ])('flows that must also hold under StrictMode%s', (_label, strict) => {
    it('SC-SR5 (1) stop keeps the round alive and the later final still fills the input', async () => {
      const user = userEvent.setup();
      renderVoice(strict);
      const recognition = await startListening(user, speech);

      await user.click(micButton('停止聆聽'));
      expect(recognition.stopCalls).toBe(1);
      expect(recognition.abortCalls).toBe(0);

      act(() => {
        recognition.emitAudioEnd();
        recognition.emitResult(SENTENCE, { isFinal: true });
        recognition.emitEnd();
      });
      await waitFor(() => expect(probe.text).toBe(SENTENCE));
      expect(inputBox()).toHaveValue(SENTENCE);
      expect(alerts()).toHaveLength(0);
      expect(mocks.parse).not.toHaveBeenCalled();
    });

    it('SC-SR5 (3) a new round right after a cancel ignores the old instance', async () => {
      const user = userEvent.setup();
      renderVoice(strict);
      const oldRecognition = await startListening(user, speech);

      await user.click(screen.getByRole('button', { name: '取消語音' }));
      expect(oldRecognition.abortCalls).toBe(1);
      const newRecognition = await startListening(user, speech);
      expect(speech.instances).toHaveLength(2);
      expect(newRecognition).not.toBe(oldRecognition);

      emitLateEvents(oldRecognition);
      expect(micButton('停止聆聽')).toBeInTheDocument();
      expect(newRecognition.abortCalls).toBe(0);
      expect(probe.text).toBe('');
      expect(alerts()).toHaveLength(0);

      act(() => newRecognition.emitResult('午餐 120 刷卡', { isFinal: true }));
      await waitFor(() => expect(probe.text).toBe('午餐 120 刷卡'));
      expect(mocks.parse).not.toHaveBeenCalled();
    });

    it('SC-SR6 (1) A → B → A ignores the final of the round started on A', async () => {
      const user = userEvent.setup();
      const { rerenderTree } = renderVoice(strict);
      const recognition = await startListening(user, speech);

      rerenderTree({ entryProps: { ledger: ledgerB } });
      rerenderTree({ entryProps: { ledger: ledgerA } });
      act(() => recognition.emitResult(SENTENCE, { isFinal: true }));

      expect(recognition.abortCalls).toBe(1);
      expect(probe.text).toBe('');
      expect(inputBox()).toHaveValue('');
      expect(mocks.parse).not.toHaveBeenCalled();
    });
  });

  it.each(cancelConditions)(
    'SC-SR5 (2) cancel by %s aborts once and ignores every later event',
    async (_name, cancel) => {
      const user = userEvent.setup();
      const { rerenderTree } = renderVoice(false);
      const recognition = await startListening(user, speech);

      await cancel({ user, rerenderTree });
      expect(recognition.abortCalls).toBe(1);

      emitLateEvents(recognition);
      expect(probe.text).toBe('');
      expect(alerts()).toHaveLength(0);
      expect(mocks.parse).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it('SC-SR5 control: window blur is not a cancel (decision 350 (e))', async () => {
    const user = userEvent.setup();
    renderVoice(false);
    const recognition = await startListening(user, speech);

    act(() => void window.dispatchEvent(new Event('blur')));
    expect(recognition.abortCalls).toBe(0);
    expect(micButton('停止聆聽')).toBeInTheDocument();

    act(() => recognition.emitResult(SENTENCE, { isFinal: true }));
    await waitFor(() => expect(probe.text).toBe(SENTENCE));
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it.each([
    [
      '登出',
      () => {
        mocks.authenticated = false;
      },
    ],
    [
      '換使用者',
      () => {
        mocks.userId = 'user-b';
      },
    ],
  ])('SC-SR6 (2) after %s the old final is not filled', async (_name, changeIdentity) => {
    const user = userEvent.setup();
    const { rerenderTree } = renderVoice(false);
    const recognition = await startListening(user, speech);

    changeIdentity();
    rerenderTree({});
    act(() => {
      recognition.emitResult(SENTENCE, { isFinal: true });
      recognition.emitEnd();
    });

    expect(probe.text).toBe('');
    expect(alerts()).toHaveLength(0);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('SC-SR6 (3) an input edited and restored to the same string still rejects the old final', async () => {
    const user = userEvent.setup();
    renderVoice(false);
    const recognition = await startListening(user, speech);

    act(() => probe.setText('x'));
    act(() => probe.setText(''));
    act(() => recognition.emitResult(SENTENCE, { isFinal: true }));

    expect(probe.text).toBe('');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
