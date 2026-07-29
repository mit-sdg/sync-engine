/** Locale-independent UTF-16 ordering, matching JavaScript's relational comparison. */
export function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
