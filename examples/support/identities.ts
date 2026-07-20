export function identities(...values: string[]): () => string {
  const remaining = [...values];
  return () => remaining.shift() ?? "unexpected";
}
