/**
 * Return an identity factory that yields the given values in order. When
 * exhausted, throws — a silent default would mask underspecified tests.
 */
export function identities(...values: string[]): () => string {
  const remaining = [...values];
  return () => {
    const next = remaining.shift();
    if (next === undefined) {
      throw new Error("identities exhausted: supply enough values for every expected id.");
    }
    return next;
  };
}
