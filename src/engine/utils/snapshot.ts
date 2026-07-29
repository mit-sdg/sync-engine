/**
 * Deep-clone plain data so later mutation of the source cannot corrupt a
 * recorded snapshot (and vice versa). Cycle- and alias-safe through `seen`:
 * one shared map preserves identity between repeated references.
 *
 * Non-plain objects (class instances, `Map`, …) pass through by reference,
 * except `Date`, which is cloned. A property whose getter throws becomes a
 * getter that throws the same error on the snapshot.
 */
import { setOwn } from "./own-property.ts";

export function snapshotValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Date.prototype) {
    try {
      const snapshot = new Date(Date.prototype.getTime.call(value));
      seen.set(value, snapshot);
      return snapshot;
    } catch {
      return value;
    }
  }
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  const snapshot: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value)
    ? []
    : Object.create(prototype);
  if (Array.isArray(snapshot)) snapshot.length = (value as unknown[]).length;
  seen.set(value, snapshot);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) continue;
    try {
      const entry = "value" in descriptor ? descriptor.value : Reflect.get(value, key, value);
      setOwn(snapshot, key, snapshotValue(entry, seen));
    } catch (error) {
      Object.defineProperty(snapshot, key, {
        get() {
          throw error;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }
  return snapshot;
}
