/**
 * The law of a batched query, checked on sample inputs.
 *
 * A batched query's list form must answer each input exactly as it answers
 * that input alone, whatever else shares the list: in any order, with
 * duplicates, and with an empty list answering an empty list. Answers for
 * different positions must share no objects, because readers that asked
 * separately may each change or compare what they got.
 */
import { structurallyEqual } from "@engine/reads/value-equality";

type ListForm = (inputs: readonly unknown[]) => unknown;

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
 * Give inputs that cover missing keys, several rows, and no rows.
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
  const list = (batch: readonly unknown[]) =>
    Promise.resolve((member as ListForm).call(concept, batch));
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
    const owner = new Map<object, number>();
    answers.forEach((answer, position) => {
      const index = order[position];
      if (!structurallyEqual(answer, alone[index])) {
        fail(
          `in ${label}, ${show(inputs[index])} answered ${show(answer)} ` +
            `but answers ${show(alone[index])} alone`,
        );
      }
      for (const object of objectsIn(answer)) {
        const other = owner.get(object);
        if (other !== undefined && other !== position) {
          fail(`in ${label}, answers at positions ${other} and ${position} share an object`);
        }
        owner.set(object, position);
      }
    });
  }
}
