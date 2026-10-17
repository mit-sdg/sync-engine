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

/**
 * Whether two answers carry the same data. Records and arrays compare by
 * content, dates by time, and other objects by their prototype and own
 * properties, so a fresh identifier object equals another with the same value.
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
  if (Array.isArray(left)) {
    const other = right as unknown[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (index in left !== index in other) return false;
      if (!sameData(left[index], other[index], seen)) return false;
    }
    return true;
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
  for (const key of Reflect.ownKeys(value)) {
    objectsIn((value as Record<PropertyKey, unknown>)[key], found);
  }
  return found;
}

function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
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
