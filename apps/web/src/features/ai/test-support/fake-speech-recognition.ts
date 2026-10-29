/**
 * 測試用的假語音辨識器（4a 語音，plan §1.1）。只給測試匯入，正式程式不可依賴它。
 *
 * jsdom 沒有 `SpeechRecognition`，真的 Chrome 的事件順序也無法在 CI 重現。這個替身讓
 * 測試手動決定「哪個實例、在什麼時候、送什麼事件」，才能模擬舊實例晚到的 result、
 * error、end（決策 350 (c)、351）。
 *
 * 設計上刻意的幾點：
 * - **不自己送任何事件**。`start()`、`stop()`、`abort()` 只記次數；`abort()` 後要不要
 *   送 error、end，由測試決定。
 * - 事件同時送給 `on*` 屬性與 `addEventListener`，實作用哪一種都測得到。
 * - 設定欄位的初始值故意和正式設定（假設 2）不同，實作沒設好時測試才看得出來。
 * - 每個 global 名稱各有自己的建構子，`both` 時能分辨實作用的是哪一個（SC-SR1 第 3 項）。
 */

export type FakeSpeechGlobalName = 'SpeechRecognition' | 'webkitSpeechRecognition';

export interface InstallFakeSpeechRecognitionOptions {
  global: FakeSpeechGlobalName | 'both';
  /** 要設給 `window.isSecureContext` 的值，預設 true（localhost 的情況）。 */
  secure?: boolean;
}

type FakeEventHandler = ((event: Event) => void) | null;

type FakeEventType = 'start' | 'audiostart' | 'audioend' | 'result' | 'error' | 'end';

export interface FakeSpeechRecognition extends EventTarget {
  /** 建出這個實例的 global 名稱。 */
  readonly constructedFrom: FakeSpeechGlobalName;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: FakeEventHandler;
  onaudiostart: FakeEventHandler;
  onaudioend: FakeEventHandler;
  onresult: FakeEventHandler;
  onerror: FakeEventHandler;
  onend: FakeEventHandler;
  readonly startCalls: number;
  readonly stopCalls: number;
  readonly abortCalls: number;
  start(): void;
  stop(): void;
  abort(): void;
  emitStart(): void;
  emitAudioStart(): void;
  emitAudioEnd(): void;
  /** 送 1 個結果，只有 1 個候選，`resultIndex` 是 0。 */
  emitResult(transcript: string, options: { isFinal: boolean }): void;
  /** 送 error 事件；`code` 是 Web Speech API 的錯誤碼，例如 `no-speech`、`aborted`。 */
  emitError(code: string): void;
  emitEnd(): void;
}

export interface FakeSpeechRecognitionController {
  /** 依建立順序排列的所有實例。 */
  readonly instances: readonly FakeSpeechRecognition[];
  /** 最後建立的實例；還沒有實例就丟錯，讓測試失敗得清楚。 */
  latest(): FakeSpeechRecognition;
  /** 設定之後的 `start()` 要丟的例外；傳 null 恢復正常。 */
  setStartError(error: Error | null): void;
  /** 移除假建構子，還原 `window` 原本的屬性。 */
  uninstall(): void;
}

/** 組出 `SpeechRecognitionResultList` 的形狀：可用索引或 `item()` 讀。 */
function createResultList(transcript: string, isFinal: boolean) {
  const alternative = { transcript, confidence: 0.9 };
  const result = Object.assign([alternative], {
    isFinal,
    item: (index: number) => (index === 0 ? alternative : null),
  });
  return Object.assign([result], {
    item: (index: number) => (index === 0 ? result : null),
  });
}

export function installFakeSpeechRecognition(
  options: InstallFakeSpeechRecognitionOptions,
): FakeSpeechRecognitionController {
  const instances: FakeSpeechRecognition[] = [];
  let startError: Error | null = null;

  function createConstructor(name: FakeSpeechGlobalName) {
    return class FakeRecognition extends EventTarget implements FakeSpeechRecognition {
      readonly constructedFrom = name;
      lang = 'en-US';
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      onstart: FakeEventHandler = null;
      onaudiostart: FakeEventHandler = null;
      onaudioend: FakeEventHandler = null;
      onresult: FakeEventHandler = null;
      onerror: FakeEventHandler = null;
      onend: FakeEventHandler = null;
      startCalls = 0;
      stopCalls = 0;
      abortCalls = 0;

      constructor() {
        super();
        instances.push(this);
      }

      start() {
        this.startCalls += 1;
        if (startError) throw startError;
      }

      stop() {
        this.stopCalls += 1;
      }

      abort() {
        this.abortCalls += 1;
      }

      private emit(type: FakeEventType, extra: Record<string, unknown> = {}) {
        const event = Object.assign(new Event(type), extra);
        this[`on${type}`]?.(event);
        this.dispatchEvent(event);
      }

      emitStart() {
        this.emit('start');
      }

      emitAudioStart() {
        this.emit('audiostart');
      }

      emitAudioEnd() {
        this.emit('audioend');
      }

      emitResult(transcript: string, { isFinal }: { isFinal: boolean }) {
        this.emit('result', { resultIndex: 0, results: createResultList(transcript, isFinal) });
      }

      emitError(code: string) {
        this.emit('error', { error: code, message: '' });
      }

      emitEnd() {
        this.emit('end');
      }
    };
  }

  const names: FakeSpeechGlobalName[] =
    options.global === 'both' ? ['SpeechRecognition', 'webkitSpeechRecognition'] : [options.global];
  const touched = ['SpeechRecognition', 'webkitSpeechRecognition', 'isSecureContext'] as const;
  const originals = new Map(
    touched.map((key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const),
  );

  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'] as const) {
    Reflect.deleteProperty(window, name);
  }
  for (const name of names) {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: createConstructor(name),
    });
  }
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: options.secure ?? true,
  });

  return {
    instances,
    latest() {
      const instance = instances.at(-1);
      if (!instance) throw new Error('No fake SpeechRecognition instance has been constructed.');
      return instance;
    },
    setStartError(error) {
      startError = error;
    },
    uninstall() {
      for (const [key, descriptor] of originals) {
        Reflect.deleteProperty(window, key);
        if (descriptor) Object.defineProperty(window, key, descriptor);
      }
    },
  };
}
