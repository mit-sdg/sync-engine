/** Normalize a user-authored label before it becomes a shared opaque item. */
export function normalizeLabel({ label }: { label: string }): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
