/** Define one enumerable own data property without invoking prototype setters. */
export function setOwn<T extends object>(object: T, key: string | symbol, value: unknown): T {
  // A key that is neither own nor inherited has no setter to reach, so assignment makes the
  // same property a define would, more cheaply. `__proto__` is inherited from
  // `Object.prototype`, so it takes the define.
  if (!(key in object)) {
    (object as Record<string | symbol, unknown>)[key] = value;
    return object;
  }
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return object;
}
