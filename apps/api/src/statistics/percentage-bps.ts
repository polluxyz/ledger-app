/** 最大餘數法：金額的乘法與加總皆使用 BigInt，分配結果保留原順序與極小分組。 */
export function allocatePercentageBps<T extends { key: string; amount: number }>(
  groups: readonly T[],
): Array<T & { percentageBps: number }> {
  if (groups.length === 0) return [];
  const amounts = groups.map(({ amount }) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError('Group amounts must be positive safe integers');
    }
    return BigInt(amount);
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);
  const allocations = groups.map((group, index) => {
    const numerator = amounts[index]! * 10000n;
    return {
      index,
      key: group.key,
      percentageBps: Number(numerator / total),
      remainder: numerator % total,
    };
  });
  const remaining = 10000 - allocations.reduce((sum, row) => sum + row.percentageBps, 0);
  const ranked = [...allocations].sort((a, b) =>
    a.remainder === b.remainder
      ? a.key < b.key
        ? -1
        : a.key > b.key
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let index = 0; index < remaining; index++) ranked[index]!.percentageBps++;
  return groups.map((group, index) => ({
    ...group,
    percentageBps: allocations[index]!.percentageBps,
  }));
}
