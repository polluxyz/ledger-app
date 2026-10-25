/**
 * 首頁版面（2l）——網頁首頁上 8 張卡怎麼排。
 *
 * 版面是「根列」由上往下排，每一列裡是一棵分割樹：`split` 把空間切成左右（`x`）或上下（`y`），
 * 葉子是一張卡。寬度與高度的比例用整數權重（加總 10000），不用浮點數，存回伺服器再讀回來不會飄。
 *
 * 這裡只有型別與常數。驗證函式 `parseHomeLayoutV1` 在 PR2 才加（spec §3.3），
 * 規則見 `docs/specs/phase-2l-home-layout.md` §3.2：
 * - 每張卡在整份版面剛好出現一次；
 * - `split` 至少 2 個子節點，`weights` 與子節點一樣多、都是正整數、加總剛好 10000；
 * - 同方向的分割不直接巢狀（`x` 裡面不直接放 `x`），讓同一個版面只有一種寫法。
 */

/** 首頁的 8 張卡。順序也是 ≤900px 固定一欄時的參考順序（待處理卡另外插入，決策 323）。 */
export const HOME_CARD_IDS = [
  'expense',
  'income',
  'net',
  'trend',
  'categories',
  'activity',
  'accounts',
  'debts',
] as const;
export type HomeCardId = (typeof HOME_CARD_IDS)[number];

/** 分割樹的節點：一張卡，或把空間切成左右／上下的分割。 */
export type HomeLayoutNode =
  | { type: 'card'; cardId: HomeCardId }
  | { type: 'split'; axis: 'x' | 'y'; children: HomeLayoutNode[]; weights: number[] };

export interface HomeLayoutBand {
  /** 列內的分割樹。 */
  root: HomeLayoutNode;
  /**
   * 使用者額外加的高度（CSS px），0～1600 的整數。列高＝內容最低高度＋這個值，
   * 所以卡片內容變長時列會自己長高，不存內容高度（決策 332）。
   */
  extraHeightPx: number;
}

/** 版面格式第 1 版。將來格式要變（例如手動隱藏卡片）就出 v2，不在 v1 偷加欄位。 */
export interface HomeLayoutV1 {
  bands: HomeLayoutBand[];
}

function card(cardId: HomeCardId): HomeLayoutNode {
  return { type: 'card', cardId };
}

/**
 * 預設版面（決策 318）：上排收支三卡、中排趨勢與分類（2：1）、下排動態、帳戶、借還。
 *
 * 使用者沒存過版面、按「重設為預設」、或伺服器的版面通不過驗證時都用它。
 * 用的地方一律當唯讀；版面運算要回傳新物件，不要直接改它。
 */
export const DEFAULT_HOME_LAYOUT_V1: HomeLayoutV1 = {
  bands: [
    {
      root: {
        type: 'split',
        axis: 'x',
        children: [card('expense'), card('income'), card('net')],
        weights: [3333, 3333, 3334],
      },
      extraHeightPx: 0,
    },
    {
      root: {
        type: 'split',
        axis: 'x',
        children: [card('trend'), card('categories')],
        weights: [6667, 3333],
      },
      extraHeightPx: 0,
    },
    {
      root: {
        type: 'split',
        axis: 'x',
        children: [card('activity'), card('accounts'), card('debts')],
        weights: [3333, 3333, 3334],
      },
      extraHeightPx: 0,
    },
  ],
};
