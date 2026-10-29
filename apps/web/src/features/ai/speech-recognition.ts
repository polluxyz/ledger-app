/** Web Speech API 在 TypeScript DOM 型別中不完整，這裡只補瀏覽器實作會用到的欄位。 */
export interface SpeechRecognitionResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

type SpeechEventHandler<EventType extends Event = Event> = (event: EventType) => void;

export interface SpeechRecognitionInstance {
  grammars: unknown;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: SpeechEventHandler | null;
  onaudiostart: SpeechEventHandler | null;
  onaudioend: SpeechEventHandler | null;
  onresult: SpeechEventHandler<SpeechRecognitionResultEvent> | null;
  onerror: SpeechEventHandler<SpeechRecognitionErrorEvent> | null;
  onend: SpeechEventHandler | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

interface WindowWithSpeechRecognition extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

/** 僅在安全環境且瀏覽器提供建構子時回傳，避免載入頁面時碰觸麥克風權限。 */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined' || window.isSecureContext !== true) return null;

  const speechWindow = window as WindowWithSpeechRecognition;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}
