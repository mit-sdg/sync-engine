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

/**
 * Turn one sequence per concept name into the identity sources a deterministic
 * floor supplies. Every concept in the set needs one: a missing name would
 * quietly fall back to random ids and only surface as a puzzling diff.
 */
export function identitiesFor(
  sequences: Readonly<Record<string, readonly string[]>>,
  names: readonly string[],
): Record<string, () => string> {
  const missing = names.filter((name) => sequences[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`deterministic identities: nothing supplied for ${missing.join(", ")}.`);
  }
  return Object.fromEntries(
    names.map((name) => [name, identities(...(sequences[name] as string[]))]),
  );
}
