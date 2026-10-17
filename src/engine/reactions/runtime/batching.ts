/**
 * Batched queries.
 *
 * A batched query's method takes a list of inputs and returns one answer per
 * input, in the same order. Readers still ask it with one input. This module
 * stands between the two: it sits beneath the query cache, so only reads the
 * cache could not answer reach it, and it calls the list form for them.
 *
 * Grouped, it collects the reads pending for the query until the current turn
 * of the event loop ends, then calls the list form once for all of them; it
 * never waits on a timer to collect more. Ungrouped, every read calls the list
 * form with a list of one. Each input is copied as plain data when it is asked.
 * The list passed is frozen, so a method that sorts its inputs in place fails
 * instead of answering the wrong reader.
 */
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { snapshotValue } from "@engine/utils/snapshot";

type ListForm = (inputs: readonly unknown[]) => unknown;

interface PendingRead {
  input: unknown;
  resolve(answer: unknown): void;
  reject(error: unknown): void;
}

// Kept from module load, so a test that fakes timers cannot stall grouped reads.
// Where the host has none, reads are not grouped.
const nextTurn: ((callback: () => void) => unknown) | undefined =
  typeof setImmediate === "function" ? setImmediate : undefined;

function describe(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} answer${value.length === 1 ? "" : "s"}`;
  return value === null ? "null" : typeof value;
}

function answersFor(answers: unknown, count: number, label: string): unknown[] {
  const inputs = `${count} input${count === 1 ? "" : "s"}`;
  if (!Array.isArray(answers) || answers.length !== count) {
    throw new Error(
      `Batched query ${label} returned ${describe(answers)} for ${inputs}; ` +
        "it must return one answer per input, in the same order.",
    );
  }
  for (let index = 0; index < count; index += 1) {
    if (!(index in answers)) {
      throw new Error(
        `Batched query ${label} left answer ${index + 1} of ${inputs} empty; ` +
          "it must return one answer per input, in the same order.",
      );
    }
  }
  return answers;
}

/** Answer one input at a time through a batched query's list form. */
export function batchedQuery(
  list: ListForm,
  label: string,
  grouped: boolean,
): (input: unknown) => Promise<unknown> {
  const call = (inputs: unknown[]): Promise<unknown> =>
    Promise.resolve().then(() => list(Object.freeze(inputs)));
  const alone = async (input: unknown): Promise<unknown> =>
    answersFor(await call([input]), 1, label)[0];
  // Each input is kept as it was asked, so a caller changing its object later
  // changes nothing: records, arrays and dates are copied, other objects kept.
  if (!grouped || nextTurn === undefined) return (input) => alone(snapshotValue(input));

  let pending: PendingRead[] | undefined;

  const flush = (group: PendingRead[]): void => {
    call(group.map((read) => read.input)).then(
      (answers) => {
        let checked: unknown[];
        try {
          checked = answersFor(answers, group.length, label);
        } catch (error) {
          for (const read of group) read.reject(error);
          return;
        }
        group.forEach((read, index) => read.resolve(checked[index]));
      },
      (error: unknown) => {
        if (group.length === 1) {
          group[0].reject(error);
          return;
        }
        // A failed group is read again as lists of one, all at once, as the
        // reads would have gone ungrouped, so a bad input fails only its own
        // read and a slow one delays only its own.
        logger.warn(
          `Batched query ${label} failed for ${group.length} inputs; reading each alone.`,
          { error: serializeError(error) },
        );
        for (const read of group) alone(read.input).then(read.resolve, read.reject);
      },
    );
  };

  return (input: unknown) =>
    new Promise((resolve, reject) => {
      if (pending === undefined) {
        const group: PendingRead[] = [];
        pending = group;
        nextTurn(() => {
          pending = undefined;
          flush(group);
        });
      }
      pending.push({ input: snapshotValue(input), resolve, reject });
    });
}
