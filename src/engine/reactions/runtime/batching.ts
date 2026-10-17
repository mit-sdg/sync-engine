/**
 * Batched queries.
 *
 * A batched query's method takes a list of inputs and returns one answer per
 * input, in the same order. Readers still ask it with one input. This module
 * stands between the two: it sits beneath the query cache, so only reads the
 * cache could not answer reach it, and it calls the list form for them.
 *
 * Grouped, it collects the reads pending for the query until the current turn
 * of the event loop ends, then calls the list form once for all of them. It
 * never waits longer to collect more. Equal inputs share one slot and one
 * answer, as a cache hit would. Ungrouped, every read calls the list form with
 * a list of one.
 */
import { logger } from "@engine/utils/logger";
import { queryInputKeys } from "@engine/utils/memoize";
import { serializeError } from "@engine/utils/redaction";

type ListForm = (inputs: unknown[]) => unknown;

interface PendingRead {
  input: unknown;
  key: string | undefined;
  resolve(answer: unknown): void;
  reject(error: unknown): void;
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} answer${value.length === 1 ? "" : "s"}`;
  return value === null ? "null" : typeof value;
}

function answersFor(answers: unknown, count: number, label: string): unknown[] {
  if (Array.isArray(answers) && answers.length === count) return answers;
  throw new Error(
    `Batched query ${label} returned ${describe(answers)} for ${count} input${count === 1 ? "" : "s"}; ` +
      "it must return one answer per input, in the same order.",
  );
}

/** Answer one input at a time through a batched query's list form. */
export function batchedQuery(
  list: ListForm,
  label: string,
  grouped: boolean,
): (input: unknown) => Promise<unknown> {
  const alone = async (input: unknown): Promise<unknown> =>
    answersFor(await list([input]), 1, label)[0];
  if (!grouped) return alone;

  const keyOf = queryInputKeys();
  let pending: PendingRead[] | undefined;

  const flush = (group: PendingRead[]): void => {
    // Equal inputs share one slot; an input too deep to key keeps its own.
    const slots: unknown[] = [];
    const slotOf = new Map<string, number>();
    const slotOfRead = group.map((read) => {
      if (read.key !== undefined) {
        const known = slotOf.get(read.key);
        if (known !== undefined) return known;
        slotOf.set(read.key, slots.length);
      }
      slots.push(read.input);
      return slots.length - 1;
    });
    Promise.resolve()
      .then(() => list(slots))
      .then(
        (answers) => {
          let checked: unknown[];
          try {
            checked = answersFor(answers, slots.length, label);
          } catch (error) {
            for (const read of group) read.reject(error);
            return;
          }
          group.forEach((read, index) => read.resolve(checked[slotOfRead[index]]));
        },
        (error: unknown) => {
          // A failed group is read again one input at a time, so a bad input
          // fails only its own read.
          logger.warn(
            `Batched query ${label} failed for ${slots.length} inputs; reading them one at a time.`,
            { error: serializeError(error) },
          );
          const retried = slots.map((input) => alone(input));
          group.forEach((read, index) => {
            retried[slotOfRead[index]].then(read.resolve, read.reject);
          });
        },
      );
  };

  return (input: unknown) =>
    new Promise((resolve, reject) => {
      if (pending === undefined) {
        const group: PendingRead[] = [];
        pending = group;
        setImmediate(() => {
          pending = undefined;
          flush(group);
        });
      }
      pending.push({ input, key: keyOf(input), resolve, reject });
    });
}
