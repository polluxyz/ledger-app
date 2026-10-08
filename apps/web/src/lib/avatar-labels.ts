/**
 * 同一區塊的頭貼先用名字首字；撞字時找每個名字最早能區分的位置，避免來回比對姓名。
 */
export function getAvatarLabels(names: readonly string[]): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const groups = new Map<string, string[]>();

  for (const name of names) {
    const first = Array.from(name)[0] ?? '';
    labels.set(name, first);
    if (name === '我' || first === '') {
      continue;
    }

    const key = first.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(name);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const namesInGroup = [...new Set(group)];
    const repeatedNames = new Set(
      namesInGroup.filter((name) => group.filter((candidate) => candidate === name).length > 1),
    );
    const usedLabels = new Set<string>();
    const candidates = new Map<string, string[]>();

    for (const name of namesInGroup) {
      const first = Array.from(name)[0] ?? '';
      if (repeatedNames.has(name)) {
        usedLabels.add(first.toLowerCase());
        continue;
      }

      const characters = Array.from(name);
      const uniqueCharacters = characters.slice(1).filter((character, offset) => {
        const index = offset + 1;
        return namesInGroup.every((otherName) => {
          if (otherName === name) {
            return true;
          }
          const otherCharacter = Array.from(otherName)[index];
          return (
            otherCharacter === undefined || otherCharacter.toLowerCase() !== character.toLowerCase()
          );
        });
      });
      candidates.set(name, uniqueCharacters);
      if (uniqueCharacters.length === 0) {
        usedLabels.add(first.toLowerCase());
      }
    }

    for (const name of namesInGroup) {
      if (repeatedNames.has(name)) {
        continue;
      }

      const first = Array.from(name)[0] ?? '';
      const available = candidates
        .get(name)
        ?.find((character) => !usedLabels.has(character.toLowerCase()));
      const label = available ?? first;
      labels.set(name, label);
      usedLabels.add(label.toLowerCase());
    }
  }

  return labels;
}
