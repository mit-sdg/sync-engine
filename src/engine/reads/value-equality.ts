/**
 * Equality for values that cross the engine boundary.
 *
 * Records and arrays compare structurally. Dates compare by timestamp. Other
 * object kinds compare only by identity, which avoids guessing at the meaning
 * of maps, sets, class instances, and custom prototypes.
 */
export function structurallyEqual(left: unknown, right: unknown): boolean {
  return compare(left, right, new WeakMap());
}

function compare(
  left: unknown,
  right: unknown,
  compared: WeakMap<object, WeakSet<object>>,
): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => compare(value, right[index], compared))
    );
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.getPrototypeOf(right)) return false;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const prior = compared.get(left);
  if (prior?.has(right) === true) return true;
  if (prior === undefined) compared.set(left, new WeakSet([right]));
  else prior.add(right);

  try {
    const leftRecord = left as Record<PropertyKey, unknown>;
    const rightRecord = right as Record<PropertyKey, unknown>;
    const leftKeys = Reflect.ownKeys(leftRecord);
    const rightKeys = Reflect.ownKeys(rightRecord);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(rightRecord, key) && compare(leftRecord[key], rightRecord[key], compared),
      )
    );
  } catch {
    return false;
  }
}
