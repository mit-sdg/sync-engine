export function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function exact(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`);
}

export function stringArray(value: unknown, label: string, unique = false): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    (unique && new Set(value).size !== value.length)
  )
    throw new Error(
      `${label} must ${unique ? "contain unique nonempty strings" : "be an array of nonempty strings"}`,
    );
  return value as string[];
}

export function stringRecord(
  value: unknown,
  label: string,
  optional = false,
): Record<string, string> {
  if (value === undefined && optional) return {};
  const record = object(value, label);
  if (
    Object.entries(record).some(
      ([name, item]) => name.length === 0 || typeof item !== "string" || item.length === 0,
    )
  )
    throw new Error(`${label} contains an invalid value`);
  return record as Record<string, string>;
}
