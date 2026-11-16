/**
 * Puts the triggers a user named during intake at the front of the chip list,
 * in the order they named them. Everything else keeps its original order.
 */
export function sortTriggersByIntake<T extends { key: string }>(items: T[], intakeKeys: string[]): T[] {
  if (intakeKeys.length === 0) {
    return items;
  }

  const rank = new Map(intakeKeys.map((key, i) => [key, i]));
  const picked = items
    .filter(item => rank.has(item.key))
    .sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  const rest = items.filter(item => !rank.has(item.key));

  return [...picked, ...rest];
}
