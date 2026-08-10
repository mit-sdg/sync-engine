export function validateDependencyGraph(
  entries: ReadonlyMap<string, { requires: readonly string[] }>,
  label: string,
): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`${label} dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const entry = entries.get(id);
    if (entry === undefined) throw new Error(`${id} requires missing ${label} entry ${id}`);
    visiting.add(id);
    for (const required of entry.requires) {
      if (!entries.has(required))
        throw new Error(`${id} requires missing ${label} entry ${required}`);
      visit(required);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of entries.keys()) visit(id);
}

export function dependencyOrder<T extends { requires: readonly string[] }>(
  entries: ReadonlyMap<string, T>,
  ids: readonly string[],
  unknown: (id: string) => Error,
): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    const entry = entries.get(id);
    if (entry === undefined) throw unknown(id);
    for (const required of entry.requires) visit(required);
    seen.add(id);
    result.push(entry);
  };
  for (const id of ids) visit(id);
  return result;
}
