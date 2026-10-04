/**
 * 分帳份額計算（3c 個人分帳與 3e 共享帳本，兩者都依 spec §3.4）。
 *
 * `computeSharesByKey` 以字串 key 計算，供共享帳本使用；`computeSplitShares` 保留 3c 的舊介面，
 * 將「我」轉成內部 key 後共用同一套規則。`fillRemainingShares` 只給畫面的「自動調整」用（決策 94），
 * 後端不呼叫——它是填表輔助，最終值仍由後端驗證。
 *
 * 全部用整數運算。四捨五入寫成 `floor((2a + b) / 2b)`，不經過浮點數除法；最大的中間值是
 * 總額上限 2e9 × 萬分比 1e4 × 2 = 4e13，遠小於 `Number.MAX_SAFE_INTEGER`。
 */
import type { Cents } from './money';
import type { SplitMethod, SplitParticipantInput, SplitPrecision } from './types/split';

/**
 * 比例的分母：萬分比。`2500` ＝ 25%，`3333` ＝ 33.33%。
 *
 * 放在這裡而不是 `types/split.ts`：本檔只能 `import type`，因為 shared 的測試靠 Node 的型別剝除
 * 直接跑 `.ts`，不帶副檔名的值匯入解析不到（plan 3c-0 §7 第 2 點）。
 */
export const SPLIT_RATIO_TOTAL = 10000;

export interface SplitShareInput {
  /** 總額，分，> 0。 */
  total: Cents;
  method: SplitMethod;
  /** 預設 `CENT`。`AMOUNT` 忽略。 */
  precision?: SplitPrecision;
  /** 付款人（收款人）；`null`＝我。決定誰是吸收者（決策 92）。 */
  payerCounterpartyId: string | null;
  participants: SplitParticipantInput[];
}

export interface ComputeSharesByKeyInput {
  /** 總額，分，> 0。 */
  total: Cents;
  method: SplitMethod;
  /** 預設 `CENT`。`AMOUNT` 忽略。 */
  precision?: SplitPrecision;
  /** 付款人（收入時是收款人）；在名單裡時由他吸收零頭。 */
  payerKey: string | null;
  /** `payerKey` 不在名單時的次順位吸收者；仍不在名單才由第一位吸收。 */
  fallbackKey?: string;
  participants: Array<{ key: string; amount?: Cents; ratio?: number }>;
}

export type SplitShareError =
  'SPLIT_PARTICIPANTS_INVALID' | 'SPLIT_SUM_MISMATCH' | 'SPLIT_SHARE_NOT_POSITIVE';

/** `shares` 與 `participants` 同順序。 */
export type SplitShareResult =
  { ok: true; shares: Cents[] } | { ok: false; error: SplitShareError };

/** 精度對應的最小單位（分）。 */
export function precisionUnit(precision: SplitPrecision = 'CENT'): number {
  return precision === 'YUAN' ? 100 : 1;
}

/** 非負整數 a ÷ 正整數 b，四捨五入到整數（.5 進位）。 */
function divRoundHalfUp(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * 吸收者（決策 92）：付款人有參加就是付款人；沒有就是我（我有參加時）；都沒有就是第一位。
 * `candidates` 是可以當吸收者的索引（計算份額時是全部的人，自動調整時是還沒固定的人）。
 */
function pickAbsorber(
  people: ReadonlyArray<{ counterpartyId: string | null }>,
  candidates: number[],
  payerCounterpartyId: string | null,
): number {
  const payer = candidates.find((index) => people[index]!.counterpartyId === payerCounterpartyId);
  if (payer !== undefined) return payer;
  const me = candidates.find((index) => people[index]!.counterpartyId === null);
  if (me !== undefined) return me;
  return candidates[0]!;
}

function participantsValidByKey(participants: Array<{ key: string }>): boolean {
  if (participants.length === 0) return false;
  const seen = new Set<string>();
  for (const participant of participants) {
    if (typeof participant.key !== 'string' || seen.has(participant.key)) return false;
    seen.add(participant.key);
  }
  return true;
}

/** 3e 的吸收者順序：付款人、3c 傳入的 fallback（我）、再到名單第一位。 */
function pickAbsorberByKey(
  participants: Array<{ key: string }>,
  payerKey: string | null,
  fallbackKey?: string,
): number {
  const payer = participants.findIndex((participant) => participant.key === payerKey);
  if (payer >= 0) return payer;
  const fallback =
    fallbackKey === undefined
      ? -1
      : participants.findIndex((participant) => participant.key === fallbackKey);
  return fallback >= 0 ? fallback : 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * 算出每個人的份額（共享帳本以字串 key 表示人，spec §3.4）。
 *
 * 1. 名單至少 1 人、沒有重複、我最多一次；分法需要的值（金額或萬分比）每個人都要有。
 * 2. 自訂金額：份額＝給的值，加總要等於總額。
 * 3. 均分權重 1/n；自訂比例權重＝萬分比 / 10000，加總要等於 10000。
 * 4. 吸收者以外的人四捨五入到精度；吸收者拿剩下的。
 * 5. 任何人 ≤ 0 → `SPLIT_SHARE_NOT_POSITIVE`。
 */
export function computeSharesByKey(input: ComputeSharesByKeyInput): SplitShareResult {
  const { total, method, payerKey, fallbackKey, participants } = input;
  if (!participantsValidByKey(participants))
    return { ok: false, error: 'SPLIT_PARTICIPANTS_INVALID' };

  let shares: number[];
  if (method === 'AMOUNT') {
    if (!participants.every((participant) => isNonNegativeInteger(participant.amount))) {
      return { ok: false, error: 'SPLIT_PARTICIPANTS_INVALID' };
    }
    shares = participants.map((participant) => participant.amount!);
    const sum = shares.reduce((a, b) => a + b, 0);
    if (sum !== total) return { ok: false, error: 'SPLIT_SUM_MISMATCH' };
  } else {
    const unit = precisionUnit(input.precision);
    let numerators: number[];
    let denominator: number;
    if (method === 'RATIO') {
      const ratios = participants.map((participant) => participant.ratio);
      if (!ratios.every((ratio) => isNonNegativeInteger(ratio) && ratio <= SPLIT_RATIO_TOTAL)) {
        return { ok: false, error: 'SPLIT_PARTICIPANTS_INVALID' };
      }
      const sum = (ratios as number[]).reduce((a, b) => a + b, 0);
      if (sum !== SPLIT_RATIO_TOTAL) return { ok: false, error: 'SPLIT_SUM_MISMATCH' };
      numerators = (ratios as number[]).map((ratio) => total * ratio);
      denominator = SPLIT_RATIO_TOTAL;
    } else {
      numerators = participants.map(() => total);
      denominator = participants.length;
    }

    const absorber = pickAbsorberByKey(participants, payerKey, fallbackKey);
    shares = numerators.map((numerator) => divRoundHalfUp(numerator, denominator * unit) * unit);
    const others = shares.reduce(
      (sum, share, index) => (index === absorber ? sum : sum + share),
      0,
    );
    shares[absorber] = total - others;
  }

  if (shares.some((share) => share <= 0)) return { ok: false, error: 'SPLIT_SHARE_NOT_POSITIVE' };
  return { ok: true, shares };
}

/** 保留 3c 原介面；NUL 不是 UUID 可用字元，因此不會和對象 id 衝突。 */
function keyForCounterpartyId(counterpartyId: string | null): string {
  return counterpartyId === null ? '\u0000me' : counterpartyId;
}

/** 3c 的「付款人缺席時優先由我吸收」行為由 fallbackKey 保留。 */
export function computeSplitShares(input: SplitShareInput): SplitShareResult {
  return computeSharesByKey({
    total: input.total,
    method: input.method,
    precision: input.precision,
    payerKey: keyForCounterpartyId(input.payerCounterpartyId),
    fallbackKey: keyForCounterpartyId(null),
    participants: input.participants.map((participant) => ({
      key: keyForCounterpartyId(participant.counterpartyId),
      amount: participant.amount,
      ratio: participant.ratio,
    })),
  });
}

export interface FillRemainingInput {
  /** 自訂金額時是總額（分）；自訂比例時不用（固定是 10000 萬分比）。 */
  total: Cents;
  method: 'AMOUNT' | 'RATIO';
  /** 自訂金額時其他人取整的精度，預設 `CENT`。自訂比例一律到 1 萬分比（0.01%）。 */
  precision?: SplitPrecision;
  payerCounterpartyId: string | null;
  /** `value` 有值＝使用者改過、固定不動；沒有值＝由剩下的平分。 */
  participants: Array<{ counterpartyId: string | null; value?: number }>;
}

export interface FillRemainingResult {
  /** 每個人的值（分或萬分比），與 `participants` 同順序。 */
  values: number[];
  /**
   * 還沒分配出去的量：0＝剛好；正數＝還差這麼多（沒有可以平分的人）；負數＝固定的值已經超過。
   * 畫面用它顯示「還差 $250」或「比例合計 115%」並停用儲存。
   */
  remainder: number;
}

/**
 * 自動調整（決策 94）：固定的人不動，其他人平分剩下的，取整與吸收規則同 `computeSplitShares`。
 * 例：3 人、比例、我固定 20% → 另外兩人各 40%。
 *
 * 剩下的是負數時，沒固定的人一律給 0、`remainder` 回報超過多少。
 */
export function fillRemainingShares(input: FillRemainingInput): FillRemainingResult {
  const { method, participants, payerCounterpartyId } = input;
  const target = method === 'RATIO' ? SPLIT_RATIO_TOTAL : input.total;
  const unit = method === 'RATIO' ? 1 : precisionUnit(input.precision);

  const values = participants.map((participant) => participant.value ?? 0);
  const fixedSum = participants.reduce((sum, participant) => sum + (participant.value ?? 0), 0);
  const free = participants
    .map((participant, index) => (participant.value === undefined ? index : -1))
    .filter((index) => index >= 0);
  const remaining = target - fixedSum;

  if (free.length === 0 || remaining <= 0) {
    return { values, remainder: remaining };
  }

  const each = divRoundHalfUp(remaining, free.length * unit) * unit;
  const absorber = pickAbsorber(participants, free, payerCounterpartyId);
  let assigned = 0;
  for (const index of free) {
    if (index === absorber) continue;
    values[index] = each;
    assigned += each;
  }
  values[absorber] = remaining - assigned;
  return { values, remainder: 0 };
}
