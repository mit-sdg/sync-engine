/**
 * Return a process-wide registry pinned to `globalThis` under a well-known
 * symbol, so duplicate copies of this package (application plus tooling, or
 * linked checkouts) share facade-to-internals associations instead of
 * forking them. When the pinned slot already holds a value it is trusted
 * (optionally after `validate`); a polluted slot yields a fresh unpinned
 * registry rather than a crash.
 */
export function globalRegistry<T>(
  key: string,
  create: () => T,
  validate?: (value: unknown) => value is T,
): T {
  const registryKey = Symbol.for(key);
  const registered = Reflect.get(globalThis, registryKey) as unknown;
  if (registered !== undefined && (validate === undefined || validate(registered))) {
    return registered as T;
  }
  const created = create();
  if (registered === undefined) Reflect.set(globalThis, registryKey, created);
  return created;
}
