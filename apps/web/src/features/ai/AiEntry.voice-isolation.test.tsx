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

function micButton(name: '開始語音記帳' | '取消語音') {
  return screen.getByRole('button', { name });
}

/**
 * 最近一次按下開始的麥克風元素。第 3 版拿掉了獨立的取消按鈕（決策 358 (b)），
 * 所以「再按麥克風」要按同一個元素，不能用名稱重新找，否則會找到別的按鈕。
 */
let currentMic: HTMLElement | null = null;

/** 按麥克風開始，停在「準備中」（只送 `start`，還沒 `audiostart`）。 */
async function startPreparing(
  user: ReturnType<typeof userEvent.setup>,
  speech: FakeSpeechRecognitionController,
): Promise<FakeSpeechRecognition> {
  currentMic = micButton('開始語音記帳');
  await user.click(currentMic);
  const recognition = speech.latest();
  expect(recognition.startCalls).toBe(1);
  act(() => recognition.emitStart());
  await waitFor(() => expect(currentMic).toHaveAccessibleName('取消語音'), { timeout: 2000 });
  return recognition;
}

/** 辨識期間再按同一顆麥克風（決策 358 (a)）。 */
async function pressMicAgain(user: ReturnType<typeof userEvent.setup>) {
  if (!currentMic) throw new Error('還沒按過麥克風');
  expect(currentMic).toHaveAccessibleName('取消語音');
  expect(currentMic).toBeEnabled();
  await user.click(currentMic);
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
  const recognition = await startPreparing(user, speech);
  act(() => recognition.emitAudioStart());
  await waitFor(() => expect(currentMic).toHaveAccessibleName('取消語音'), { timeout: 2000 });
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
  ['再按麥克風', async ({ user }) => pressMicAgain(user)],
  ['辨識期間按 Escape', () => void fireEvent.keyDown(micButton('取消語音'), { key: 'Escape' })],
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
 * 驗證語音辨識的「取消與有效性」（spec `phase-4a-voice.md` SC-SR5、SC-SR6、SC-SR7 第 1 項）。
 *
 * 這是資料隔離的防線：舊的辨識結果不能套到別的身分、別的帳本，或已經被改過的輸入欄。
 * 策略是用假辨識器手動送事件，模擬「取消之後舊實例才送來 result、error、end」，再從
 * AI session 讀輸入欄文字。只透過畫面操作與按鈕名稱（W259），不綁 hook 的內部 API。
 * 第 3 版起再按麥克風＝取消（決策 358）；「停止後照常填入」只剩 30 秒上限會走到，
 * 改由 `AiEntry.voice.test.tsx` 的 SC-SR8 第 1 項驗。
 * 每一條都斷言解析次數：語音流程本身一律 0 次（決策 349 (b)）。
 */
describe('AI entry voice isolation', () => {
  let speech: FakeSpeechRecognitionController;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    currentMic = null;
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
    it.each([
      ['準備中', (user: ReturnType<typeof userEvent.setup>) => startPreparing(user, speech)],
      ['聆聽中', (user: ReturnType<typeof userEvent.setup>) => startListening(user, speech)],
      [
        '辨識中',
        async (user: ReturnType<typeof userEvent.setup>) => {
          const recognition = await startListening(user, speech);
          act(() => recognition.emitAudioEnd());
          return recognition;
        },
      ],
    ])(
      'SC-SR5 (1) pressing the mic again while %s cancels and ignores every later event',
      async (_state, reachState) => {
        const user = userEvent.setup();
        renderVoice(strict);
        const recognition = await reachState(user);

        await pressMicAgain(user);
        expect(recognition.abortCalls).toBe(1);
        expect(recognition.stopCalls).toBe(0);
        await waitFor(() => expect(currentMic).toHaveAccessibleName('開始語音記帳'));

        emitLateEvents(recognition);
        expect(probe.text).toBe('');
        expect(inputBox()).toHaveValue('');
        expect(alerts()).toHaveLength(0);
        expect(mocks.parse).not.toHaveBeenCalled();
      },
    );

    it('SC-SR7 (1) a double press starts then cancels one round; the third press starts a new one', async () => {
      const user = userEvent.setup();
      renderVoice(strict);
      const mic = micButton('開始語音記帳');

      await user.dblClick(mic);
      expect(speech.instances).toHaveLength(1);
      const first = speech.latest();
      expect(first.startCalls).toBe(1);
      expect(first.abortCalls).toBe(1);
      expect(first.stopCalls).toBe(0);
      await waitFor(() => expect(mic).toHaveAccessibleName('開始語音記帳'));

      emitLateEvents(first);
      expect(probe.text).toBe('');
      expect(alerts()).toHaveLength(0);

      await user.click(mic);
      expect(speech.instances).toHaveLength(2);
      expect(speech.latest().startCalls).toBe(1);
      expect(speech.latest().abortCalls).toBe(0);
      expect(mocks.parse).not.toHaveBeenCalled();
    });

    it('SC-SR5 (3) a new round right after a cancel ignores the old instance', async () => {
      const user = userEvent.setup();
      renderVoice(strict);
      const oldRecognition = await startListening(user, speech);

      await pressMicAgain(user);
      expect(oldRecognition.abortCalls).toBe(1);
      const newRecognition = await startListening(user, speech);
      expect(speech.instances).toHaveLength(2);
      expect(newRecognition).not.toBe(oldRecognition);

      emitLateEvents(oldRecognition);
      expect(currentMic).toHaveAccessibleName('取消語音');
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

  // 決策 358 (b)：拿掉獨立的取消按鈕。辨識期間名稱是「取消語音」的按鈕只有麥克風一顆。
  it.each(['準備中', '聆聽中'] as const)(
    'decision 358 (b) while %s the only cancel button is the microphone itself',
    async (state) => {
      const user = userEvent.setup();
      renderVoice(false);
      if (state === '準備中') await startPreparing(user, speech);
      else await startListening(user, speech);

      expect(screen.getAllByRole('button', { name: '取消語音' })).toEqual([currentMic]);
      expect(screen.queryByRole('button', { name: '停止聆聽' })).not.toBeInTheDocument();
    },
  );

  it('SC-SR5 control: window blur is not a cancel (decision 350 (e))', async () => {
    const user = userEvent.setup();
    renderVoice(false);
    const recognition = await startListening(user, speech);

    act(() => void window.dispatchEvent(new Event('blur')));
    expect(recognition.abortCalls).toBe(0);
    expect(currentMic).toHaveAccessibleName('取消語音');

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

  // 上一條中間有一次 render 看得到 'x'，「輸入欄有字就不能開始」會先把這一輪取消。
  // 這條把兩次改動放進同一批更新，畫面從頭到尾都是空字串，只剩輸入版本擋得住（突變檢查用）。
  it('SC-SR6 (3) an edit and restore inside one batched update still rejects the old final', async () => {
    const user = userEvent.setup();
    renderVoice(false);
    const recognition = await startListening(user, speech);

    act(() => {
      probe.setText('x');
      probe.setText('');
    });
    act(() => recognition.emitResult(SENTENCE, { isFinal: true }));

    expect(probe.text).toBe('');
    expect(inputBox()).toHaveValue('');
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
