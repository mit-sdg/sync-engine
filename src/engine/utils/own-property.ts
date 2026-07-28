/** Define one enumerable own data property without invoking prototype setters. */
export function setOwn<T extends object>(object: T, key: string | symbol, value: unknown): T {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return object;
}
