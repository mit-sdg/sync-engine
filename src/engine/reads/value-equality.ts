/**
 * Equality for live values that cross the engine boundary.
 *
 * Records and arrays compare structurally. Arrays compare by length and every
 * index, a hole comparing as `undefined`; other array properties are ignored.
 * Dates compare by timestamp. Other object kinds compare only by identity,
 * which avoids guessing at the meaning of maps, sets, class instances, and
 * custom prototypes. A pair of records or arrays met again during one
 * comparison is taken as equal, since it is either still being compared or
 * already found equal, so cyclic values compare by their unfolding and a shared
 * pair is compared once.
 *
 * This is the lenient runtime equality: any pair of values is comparable and
 * symbol keys participate. For design-time comparison of serialized IR —
 * strict JSON where non-plain values are rejected rather than tolerated — see
 * `canonicallyEqual` in the engine's canonical-json utility.
 */
export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  return compare(left, right, new WeakMap());
}

/**
 * Record a pair as under comparison; false when it already is. A false result anywhere returns
 * false to the top, so a pair met again is either being compared or was found equal.
 */
function enter(left: object, right: object, compared: WeakMap<object, WeakSet<object>>): boolean {
  const prior = compared.get(left);
  if (prior?.has(right) === true) return false;
  if (prior === undefined) compared.set(left, new WeakSet([right]));
  else prior.add(right);
  return true;
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
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    if (!enter(left, right, compared)) return true;
    for (let index = 0; index < left.length; index += 1) {
      if (!compare(left[index], right[index], compared)) return false;
    }
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(left);
  if (prototype !== Object.getPrototypeOf(right)) return false;
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (!enter(left, right, compared)) return true;

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
