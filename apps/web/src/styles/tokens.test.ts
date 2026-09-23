import { describe, expect, it } from 'vitest';
import css from './global.css?raw';

/**
 * 設計 token 的守門員。
 *
 * 驗兩件事，兩件都是「改錯了畫面不會壞、只會變難讀」的那種錯，最難被發現：
 *
 * 1. **淺色 token 的兩塊逐字相同。** CSS 寫不出「屬性或媒體查詢」，淺色只能寫兩次
 *    （見 global.css 檔頭）。改了一塊忘了另一塊，症狀是「手動選淺色」與「跟隨系統的
 *    淺色」長得不一樣。
 * 2. **每一組前景與背景的對比都及格**（WCAG 2.x）：文字 4.5:1，焦點框 3:1。
 *    表格照抄 `docs/specs/phase-2h-web-visual.md` §4.3。
 *
 * 策略：直接讀 global.css 的原始文字（`?raw`），不經過瀏覽器——jsdom 不算 CSS
 * 變數，也不理媒體查詢。
 */

/** 抓出 `選擇器 { ... }` 的內容。選擇器照字面比對。 */
function blockBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`找不到 ${selector}`);
  }
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
}

/** 把區塊內容變成 `{ '--color-bg': '#100f0c', ... }`，忽略註解。 */
function declarations(body: string): Record<string, string> {
  const withoutComments = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const result: Record<string, string> = {};
  for (const line of withoutComments.split(';')) {
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name !== '') {
      result[name] = value;
    }
  }
  return result;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const dark = declarations(blockBody(css, ':root'));
const lightManual = declarations(blockBody(css, ":root[data-theme='light']"));
const lightSystem = declarations(blockBody(css, ":root:not([data-theme='dark'])"));
// 淺色區塊只覆寫有變的 token，其餘（例如側欄）沿用 :root。
const light = { ...dark, ...lightManual };

/** [說明, 前景 token, 背景 token, 門檻] */
const PAIRS: [string, string, string, number][] = [
  ['正文 / surface', '--color-text', '--color-surface', 4.5],
  ['次要文字 / surface', '--color-text-muted', '--color-surface', 4.5],
  ['次要文字 / bg', '--color-text-muted', '--color-bg', 4.5],
  ['accent / surface', '--color-accent', '--color-surface', 4.5],
  ['按鈕文字 / 按鈕', '--color-on-primary', '--color-primary', 4.5],
  ['收入 / surface', '--color-income', '--color-surface', 4.5],
  ['支出 / surface', '--color-expense', '--color-surface', 4.5],
  ['轉帳 / surface', '--color-transfer', '--color-surface', 4.5],
  ['危險 / surface', '--color-danger', '--color-surface', 4.5],
  ['側欄文字 / 側欄', '--color-chrome-text', '--color-chrome', 4.5],
  ['側欄次要文字 / 側欄', '--color-chrome-muted', '--color-chrome', 4.5],
  ['側欄選中文字 / 選中底', '--color-chrome-active-text', '--color-chrome-active-bg', 4.5],
  ['焦點框 / surface', '--color-focus-ring', '--color-surface', 3],
  ['焦點框 / bg', '--color-focus-ring', '--color-bg', 3],
  ['側欄焦點框 / 側欄', '--color-chrome-focus-ring', '--color-chrome', 3],
];

describe('design tokens', () => {
  it('declares the light theme identically for the toggle and for the system setting', () => {
    expect(lightSystem).toEqual(lightManual);
  });

  it('switches native controls to the matching color scheme', () => {
    expect(dark['color-scheme']).toBe('dark');
    expect(lightManual['color-scheme']).toBe('light');
  });

  describe.each([
    ['dark', dark],
    ['light', light],
  ])('%s theme', (_name, tokens) => {
    it.each(PAIRS)('%s meets its contrast threshold', (_label, fg, bg, threshold) => {
      const foreground = tokens[fg];
      const background = tokens[bg];
      // 對比只能對實際色碼算。token 若改成 color-mix() 之類的推導值，要改這張表。
      expect(foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(threshold);
    });
  });
});
