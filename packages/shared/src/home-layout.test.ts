/**
 * 首頁版面驗證函式 `parseHomeLayoutV1` 的契約測試（2l，SC-Y12）。
 *
 * 後端存檔前、前端讀回伺服器版面時都靠這個函式把關，所以 spec §3.2、§3.3 的每一條規則
 * 各至少一組合格與一組不合格。只斷言 `ok`，不斷言失敗原因的代碼——代碼只給前端開發看，
 * 不是契約。
 *
 * 策略：版面用測試裡自己寫的字面值組出來（被測檔只能 `import type`，不從 shared 匯入
 * `DEFAULT_HOME_LAYOUT_V1`）。不合格的例子都從合格的預設版面改一處，確保失敗是那一處造成的。
 *
 * 有兩條上限在合法版面下碰不到：8 張卡各出現一次、每個分割至少 2 個子節點，節點最多 15 個，
 * 根列最多 8 列。這兩條只驗「超過就失敗」，是防禦用的。分割深度則碰得到：8 張卡最多疊 7 層。
 * 深度的算法：從根列往下最長的一條路徑上有幾個分割節點。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseHomeLayoutV1 } from './home-layout.ts';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const CARDS = [
  'expense',
  'income',
  'net',
  'trend',
  'categories',
  'activity',
  'accounts',
  'debts',
] as const;

function card(cardId: string): Json {
  return { type: 'card', cardId };
}

function split(axis: string, children: Json[], weights: number[]): Json {
  return { type: 'split', axis, children, weights };
}

/** 平均分配的權重，零頭給最後一個，加總剛好 10000。 */
function even(count: number): number[] {
  const base = Math.floor(10000 / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? 10000 - base * (count - 1) : base,
  );
}

function row(ids: readonly string[]): Json {
  return split('x', ids.map(card), even(ids.length));
}

function band(root: Json, extraHeightPx: Json = 0): { root: Json; extraHeightPx: Json } {
  return { root, extraHeightPx };
}

/** spec §3.2 的預設版面（決策 318），每次呼叫都給新物件，讓各測試可以改。 */
function defaultLayout() {
  return {
    bands: [
      band(split('x', [card('expense'), card('income'), card('net')], [3333, 3333, 3334])),
      band(split('x', [card('trend'), card('categories')], [6667, 3333])),
      band(split('x', [card('activity'), card('accounts'), card('debts')], [3333, 3333, 3334])),
    ],
  };
}

function accepts(input: unknown): void {
  const result = parseHomeLayoutV1(input);
  assert.equal(result.ok, true, `應該合格：${JSON.stringify(input)}`);
}

function rejects(input: unknown): void {
  const result = parseHomeLayoutV1(input);
  assert.equal(result.ok, false, `應該不合格：${safeStringify(input)}`);
}

function safeStringify(input: unknown): string {
  try {
    return JSON.stringify(input)?.slice(0, 200) ?? String(input);
  } catch {
    return '（無法序列化）';
  }
}

describe('parseHomeLayoutV1：合格的版面', () => {
  it('預設版面合格，回傳的版面與輸入內容相同', () => {
    const input = defaultLayout();
    const result = parseHomeLayoutV1(input);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.layout, defaultLayout());
    }
  });

  it('從 JSON 字串解析出來的版面合格（伺服器讀回的形狀）', () => {
    accepts(JSON.parse(JSON.stringify(defaultLayout())));
  });

  it('8 張卡排成一列合格', () => {
    accepts({ bands: [band(row(CARDS))] });
  });

  it('根列直接放一張卡合格；8 列各一張卡（根列上限 8）合格', () => {
    accepts({ bands: CARDS.map((id) => band(card(id))) });
  });

  it('不同方向的分割可以巢狀', () => {
    accepts({
      bands: [
        band(
          split(
            'x',
            [card('expense'), split('y', [row(['income', 'net']), card('trend')], [5000, 5000])],
            [5000, 5000],
          ),
        ),
        band(row(['categories', 'activity', 'accounts', 'debts'])),
      ],
    });
  });

  it('沒有原型的物件（Object.create(null)）也算 plain object', () => {
    const layout = Object.create(null) as Record<string, unknown>;
    layout.bands = defaultLayout().bands;
    accepts(layout);
  });
});

describe('parseHomeLayoutV1：整份版面的形狀', () => {
  it('不是物件就不合格', () => {
    for (const input of [null, undefined, 0, 'layout', true, [], [defaultLayout()]]) {
      rejects(input);
    }
  });

  it('bands 缺少、不是陣列、或是空陣列都不合格', () => {
    rejects({});
    rejects({ bands: null });
    rejects({ bands: {} });
    rejects({ bands: 'expense' });
    rejects({ bands: [] });
  });

  it('根列超過 8 列不合格', () => {
    rejects({ bands: [...CARDS, 'expense'].map((id) => band(card(id))) });
  });

  it('不是 plain object 的物件不合格（class 實例、自訂原型）', () => {
    class Layout {
      bands = defaultLayout().bands;
    }
    rejects(new Layout());

    const withProto = Object.create({ inherited: true }) as Record<string, unknown>;
    withProto.bands = defaultLayout().bands;
    rejects(withProto);

    const bandWithProto = Object.create({}) as Record<string, unknown>;
    Object.assign(bandWithProto, defaultLayout().bands[0]);
    rejects({ bands: [bandWithProto, ...defaultLayout().bands.slice(1)] });
  });

  it('只看自有屬性：繼承來的 bands 不算數', () => {
    rejects(Object.create(defaultLayout()));
  });
});

describe('parseHomeLayoutV1：規定以外的鍵', () => {
  it('頂層多了 hiddenCardIds 不合格', () => {
    rejects({ ...defaultLayout(), hiddenCardIds: [] });
  });

  it('根列、卡片、分割多了任何鍵都不合格', () => {
    const extraOnBand = defaultLayout();
    Object.assign(extraOnBand.bands[0]!, { height: 100 });
    rejects(extraOnBand);

    const extraOnCard = defaultLayout();
    extraOnCard.bands[0] = band(
      split(
        'x',
        [{ type: 'card', cardId: 'expense', axis: 'x' }, card('income'), card('net')],
        [3333, 3333, 3334],
      ),
    );
    rejects(extraOnCard);

    const extraOnSplit = defaultLayout();
    extraOnSplit.bands[1] = band({
      type: 'split',
      axis: 'x',
      children: [card('trend'), card('categories')],
      weights: [6667, 3333],
      cardId: 'trend',
    });
    rejects(extraOnSplit);
  });

  it('自有鍵 __proto__、constructor、prototype 不合格（任何一層）', () => {
    // 物件字面值的 `__proto__` 會設定原型，不是自有鍵；JSON.parse 才會建出自有鍵。
    const base = JSON.stringify(defaultLayout());
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      rejects(JSON.parse(`{"${key}":{},${base.slice(1)}`));
      rejects(JSON.parse(base.replace('{"root"', `{"${key}":{},"root"`)));
      rejects(JSON.parse(base.replace('{"type":"card"', `{"${key}":{},"type":"card"`)));
      rejects(JSON.parse(base.replace('{"type":"split"', `{"${key}":{},"type":"split"`)));
    }
  });
});

describe('parseHomeLayoutV1：根列的 extraHeightPx', () => {
  function withExtra(extraHeightPx: Json) {
    const layout = defaultLayout();
    layout.bands[2] = band(layout.bands[2]!.root, extraHeightPx);
    return layout;
  }

  it('0 與 1600 合格', () => {
    accepts(withExtra(0));
    accepts(withExtra(1600));
  });

  it('負數、超過 1600、非整數、非數字、缺少都不合格', () => {
    for (const value of [-1, 1601, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0', null]) {
      rejects(withExtra(value as Json));
    }
    const missing = defaultLayout();
    missing.bands[0] = { root: missing.bands[0]!.root } as ReturnType<typeof band>;
    rejects(missing);
  });

  it('缺少 root 不合格', () => {
    const layout = defaultLayout();
    layout.bands[0] = { extraHeightPx: 0 } as ReturnType<typeof band>;
    rejects(layout);
  });
});

describe('parseHomeLayoutV1：卡片', () => {
  function withFirstRow(children: Json[], weights = even(children.length)) {
    const layout = defaultLayout();
    layout.bands[0] = band(split('x', children, weights));
    return layout;
  }

  it('不認得的卡片 id 不合格', () => {
    rejects(withFirstRow([card('expense'), card('income'), card('savings')]));
  });

  it('同一張卡出現兩次不合格', () => {
    rejects(withFirstRow([card('expense'), card('income'), card('net'), card('trend')]));
  });

  it('少一張卡不合格', () => {
    rejects(withFirstRow([card('expense'), card('income')]));
  });

  it('cardId 不是字串、或缺少 cardId 不合格', () => {
    rejects(withFirstRow([card('expense'), card('income'), { type: 'card', cardId: 3 }]));
    rejects(withFirstRow([card('expense'), card('income'), { type: 'card' }]));
  });

  it('type 不是 card 或 split 不合格', () => {
    rejects(withFirstRow([card('expense'), card('income'), { type: 'widget', cardId: 'net' }]));
    rejects(withFirstRow([card('expense'), card('income'), { cardId: 'net' }]));
  });
});

describe('parseHomeLayoutV1：分割', () => {
  function withTrendRow(root: Json) {
    const layout = defaultLayout();
    layout.bands[1] = band(root);
    return layout;
  }

  it('axis 不是 x 或 y 不合格', () => {
    rejects(withTrendRow(split('z', [card('trend'), card('categories')], [6667, 3333])));
    rejects(
      withTrendRow({
        type: 'split',
        children: [card('trend'), card('categories')],
        weights: [1, 9999],
      }),
    );
  });

  it('只有 1 個子節點不合格；children 不是陣列不合格', () => {
    const layout = defaultLayout();
    layout.bands[1] = band(split('x', [card('trend')], [10000]));
    layout.bands.push(band(card('categories')));
    rejects(layout);
    rejects(withTrendRow({ type: 'split', axis: 'x', children: {}, weights: [6667, 3333] }));
  });

  it('weights 長度與子節點數不同不合格', () => {
    rejects(withTrendRow(split('x', [card('trend'), card('categories')], [10000])));
    rejects(withTrendRow(split('x', [card('trend'), card('categories')], [5000, 3000, 2000])));
  });

  it('weights 有 0、負數、非整數、非數字不合格', () => {
    for (const weights of [
      [10000, 0],
      [10001, -1],
      [6666.5, 3333.5],
      [Number.NaN, 10000],
    ]) {
      rejects(withTrendRow(split('x', [card('trend'), card('categories')], weights)));
    }
    rejects(
      withTrendRow({
        type: 'split',
        axis: 'x',
        children: [card('trend'), card('categories')],
        weights: ['6667', 3333],
      }),
    );
  });

  it('weights 加總不是 10000 不合格（多 1、少 1）', () => {
    rejects(withTrendRow(split('x', [card('trend'), card('categories')], [6667, 3334])));
    rejects(withTrendRow(split('x', [card('trend'), card('categories')], [6667, 3332])));
  });

  it('權重最小的合法值：1 與 9999 合格', () => {
    accepts(withTrendRow(split('x', [card('trend'), card('categories')], [1, 9999])));
  });

  it('同方向的分割直接巢狀不合格（x 裡放 x、y 裡放 y）', () => {
    const nestedX = defaultLayout();
    nestedX.bands = [
      band(
        split('x', [row(['expense', 'income']), card('net'), card('trend')], [5000, 2500, 2500]),
      ),
      band(row(['categories', 'activity', 'accounts', 'debts'])),
    ];
    rejects(nestedX);

    const nestedY = defaultLayout();
    nestedY.bands = [
      band(
        split(
          'y',
          [split('y', [card('expense'), card('income')], [5000, 5000]), card('net')],
          [5000, 5000],
        ),
      ),
      band(row(['trend', 'categories', 'activity', 'accounts', 'debts'])),
    ];
    rejects(nestedY);
  });
});

describe('parseHomeLayoutV1：深度、節點數、大小上限', () => {
  /** 從 ids 疊出 x、y 交錯的一串分割；最後一層放剩下的 lastCount 張卡。 */
  function chain(ids: readonly string[], lastCount: number, axis: 'x' | 'y' = 'x'): Json {
    if (ids.length === lastCount) {
      return split(axis, ids.map(card), even(ids.length));
    }
    return split(
      axis,
      [card(ids[0]!), chain(ids.slice(1), lastCount, axis === 'x' ? 'y' : 'x')],
      [5000, 5000],
    );
  }

  it('分割深度 6 合格', () => {
    accepts({ bands: [band(chain(CARDS, 3))] });
  });

  it('分割深度 7 不合格', () => {
    rejects({ bands: [band(chain(CARDS, 2))] });
  });

  it('節點超過 32 個不合格', () => {
    const many = Array.from({ length: 32 }, (_, index) => card(CARDS[index % CARDS.length]!));
    rejects({ bands: [band(split('x', many, even(many.length)))] });
  });

  it('序列化後超過 16384 bytes 不合格，多位元組字元以 UTF-8 計', () => {
    const layout = defaultLayout();
    Object.assign(layout.bands[0]!, { note: 'a'.repeat(16384) });
    rejects(layout);
    // 6000 個中文字：字串長度 6000，UTF-8 是 18000 bytes。
    // 這兩例也會因為多了 note 鍵而失敗：合法版面到不了這個大小，大小上限是防禦用的。
    const wide = defaultLayout();
    Object.assign(wide.bands[0]!, { note: '版'.repeat(6000) });
    rejects(wide);
  });

  it('無法序列化的輸入不丟例外，回傳不合格', () => {
    const circular = defaultLayout() as Record<string, unknown>;
    circular.self = circular;
    assert.doesNotThrow(() => parseHomeLayoutV1(circular));
    rejects(circular);
    assert.doesNotThrow(() => parseHomeLayoutV1({ bands: [band(card('expense'), 1n as never)] }));
    rejects({ bands: [band(card('expense'), 1n as never)] });
  });
});
