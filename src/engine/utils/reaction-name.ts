/** Whether a lowered reaction name belongs to one of the named authored roots. */
export function reactionNameBelongsTo(name: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => name === root || name.startsWith(`${root}#`) || name.startsWith(`${root}:`),
  );
}
