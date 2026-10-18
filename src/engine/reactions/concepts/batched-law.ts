/**
 * The law of a batched query, checked on sample inputs.
 *
 * A batched query's list form must answer each input exactly as it answers
 * that input alone, whatever else shares the list: in any order, with
 * duplicates, and with an empty list answering an empty list. Answers for
 * different inputs must share no objects, because readers that asked
 * separately may each change or compare what they got.
 */
import { structurallyEqual } from "@engine/reads/value-equality";

type ListForm = (inputs: readonly unknown[]) => unknown;
type Keyed = ReadonlyMap<unknown, unknown> | ReadonlySet<unknown>;

const isObject = (value: unknown): value is object =>
  (typeof value === "object" && value !== null) || typeof value === "function";

function isThenable(value: unknown): boolean {
  return isObject(value) && typeof (value as { then?: unknown }).then === "function";
}

function className(value: object): string {
  const name = (Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null)
    ?.constructor?.name;
  return typeof name === "string" && name !== "" ? name : "(anonymous)";
}

/** The bytes of a typed array, a `DataView`, a `Buffer`, or an `ArrayBuffer`. */
function bytesOf(value: ArrayBufferView | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

function sameBytes(left: ArrayBufferView | ArrayBuffer, right: ArrayBufferView | ArrayBuffer) {
  const [ours, theirs] = [bytesOf(left), bytesOf(right)];
  return ours.length === theirs.length && ours.every((byte, index) => byte === theirs[index]);
}

/**
 * Whether two maps, or two sets, hold the same entries in any order. A
 * primitive key is looked up; an object key pairs with a key of the other that
 * carries the same data, each key used once.
 */
function sameEntries(left: Keyed, right: Keyed, seen: Map<object, object>): boolean {
  if (left.size !== right.size) return false;
  const entry = (keyed: Keyed, key: unknown) => (keyed instanceof Map ? keyed.get(key) : undefined);
  const unmatched = [...right.keys()].filter(isObject);
  for (const key of left.keys()) {
    if (!isObject(key)) {
      if (!right.has(key) || !sameData(entry(left, key), entry(right, key), seen)) return false;
      continue;
    }
    const index = unmatched.findIndex((other) => {
      // A trial that fails must leave no pairs behind.
      const trial = new Map(seen);
      if (!sameData(key, other, trial) || !sameData(entry(left, key), entry(right, other), trial)) {
        return false;
      }
      for (const [from, to] of trial) seen.set(from, to);
      return true;
    });
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

/**
 * Whether two answers carry the same data. Records and arrays compare by
 * content, dates by time, maps and sets by entries, and binary data by its
 * bytes. Any other object, such as a class instance, a regular expression or a
 * promise, may keep data the comparison cannot see, so the check fails on it
 * rather than passing it.
 */
function sameData(left: unknown, right: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (left instanceof Date || right instanceof Date) return structurallyEqual(left, right);
  if (seen.get(left) === right) return true;
  seen.set(left, right);
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (ArrayBuffer.isView(left) || left instanceof ArrayBuffer) {
    return sameBytes(left, right as ArrayBufferView | ArrayBuffer);
  }
  if (Array.isArray(left)) {
    const other = right as unknown[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (index in left !== index in other) return false;
      if (!sameData(left[index], other[index], seen)) return false;
    }
    return true;
  }
  const keyed = left instanceof Map || left instanceof Set;
  if (keyed && !sameEntries(left, right as Keyed, seen)) return false;
  const prototype = Object.getPrototypeOf(left);
  if (!keyed && prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `checkBatchedQuery: cannot compare answers of class ${className(left)}; ` +
        "answer with records, arrays, dates, maps, sets or binary data.",
    );
  }
  const keys = Reflect.ownKeys(left);
  if (keys.length !== Reflect.ownKeys(right).length) return false;
  return keys.every(
    (key) =>
      Object.hasOwn(right, key) &&
      sameData(
        (left as Record<PropertyKey, unknown>)[key],
        (right as Record<PropertyKey, unknown>)[key],
        seen,
      ),
  );
}

function objectsIn(value: unknown, found = new Set<object>()): Set<object> {
  if (value === null || typeof value !== "object" || found.has(value)) return found;
  found.add(value);
  if (value instanceof Map || value instanceof Set) {
    for (const [key, entry] of value.entries()) {
      objectsIn(key, found);
      objectsIn(entry, found);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    objectsIn((value as Record<PropertyKey, unknown>)[key], found);
  }
  return found;
}

function show(value: unknown): string {
  try {
    const entries = (_key: string, entry: unknown) =>
      entry instanceof Map || entry instanceof Set ? [...entry] : entry;
    return JSON.stringify(value, entries) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Check a batched query's law on the raw concept instance with sample inputs.
 * Resolves when the law holds and rejects with an error naming what differed.
 * Give distinct inputs that cover missing keys, several rows, and no rows.
 */
export async function checkBatchedQuery(
  concept: object,
  query: string,
  inputs: readonly Record<string, unknown>[],
): Promise<void> {
  const member = (concept as Record<string, unknown>)[query];
  if (typeof member !== "function") {
    throw new Error(`checkBatchedQuery: ${query} is not a method of the concept.`);
  }
  // Frozen, as the engine passes it.
  const list = (batch: readonly unknown[]) =>
    Promise.resolve((member as ListForm).call(concept, Object.freeze([...batch])));
  const fail = (what: string): never => {
    throw new Error(`Batched query ${query} breaks its law: ${what}.`);
  };
  const answered = async (batch: readonly unknown[], label: string): Promise<unknown[]> => {
    const answers = await list(batch);
    if (!Array.isArray(answers) || answers.length !== batch.length) {
      fail(
        `${label} gave ${batch.length} inputs and got ` +
          `${Array.isArray(answers) ? answers.length : typeof answers} answers`,
      );
    }
    for (let position = 0; position < batch.length; position += 1) {
      if (!(position in (answers as unknown[]))) fail(`${label} left answer ${position} empty`);
    }
    const promised = (answers as unknown[]).findIndex(isThenable);
    if (promised !== -1) {
      // Not awaited, since a list form returns answers rather than a promise
      // for each; each is still handled, so a rejection is not left unhandled.
      for (const answer of answers as unknown[]) {
        if (isThenable(answer)) Promise.resolve(answer).catch(() => {});
      }
      throw new Error(
        `checkBatchedQuery: ${query} gave a promise as answer ${promised} for ${label}; ` +
          "a list form returns its answers, so await them first, for example with Promise.all.",
      );
    }
    return answers as unknown[];
  };

  await answered([], "an empty list");
  const alone: unknown[] = [];
  for (const input of inputs) alone.push((await answered([input], `the list [${show(input)}]`))[0]);

  const positions = inputs.map((_, index) => index);
  const orders: [string, number[]][] = [
    ["the samples in order", positions],
    ["the samples reversed", [...positions].reverse()],
    ["the samples with each repeated", positions.flatMap((index) => [index, index])],
  ];
  for (const [label, order] of orders) {
    const answers = await answered(
      order.map((index) => inputs[index]),
      label,
    );
    // Answers to equal inputs may share objects, as a cache hit would; answers
    // to different inputs may not.
    const owner = new Map<object, number>();
    for (let position = 0; position < answers.length; position += 1) {
      const index = order[position];
      if (!sameData(answers[position], alone[index])) {
        fail(
          `in ${label}, ${show(inputs[index])} answered ${show(answers[position])} ` +
            `but answers ${show(alone[index])} alone`,
        );
      }
      for (const object of objectsIn(answers[position])) {
        const other = owner.get(object);
        if (other !== undefined && !structurallyEqual(inputs[other], inputs[index])) {
          fail(
            `in ${label}, the answers for ${show(inputs[other])} and ${show(inputs[index])} share an object`,
          );
        }
        owner.set(object, index);
      }
    }
  }
}
