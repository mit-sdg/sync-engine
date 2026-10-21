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
 * form with a list of one. Each input is copied when it is asked: records,
 * arrays and plain dates are copied, other objects kept. The list passed is
 * frozen, so a method that sorts its inputs in place fails instead of answering
 * the wrong reader. A group whose call throws, or whose answers are not one per
 * input, is read again with each input alone.
 */
import { setImmediate as hostSetImmediate } from "node:timers";
import { logger } from "@engine/utils/logger";
import { quiet } from "@engine/utils/quiet";
import { serializeError } from "@engine/utils/redaction";
import { snapshotValue } from "@engine/utils/snapshot";

type ListForm = (inputs: readonly unknown[]) => unknown;

interface PendingRead {
  input: unknown;
  resolve(answer: unknown): void;
  reject(error: unknown): void;
}

// Taken from `node:timers`, which test runners leave alone when they fake the
// global timers, so faked timers cannot stall grouped reads. Where it has no
// `setImmediate`, reads are not grouped.
const nextTurn: ((callback: () => void) => unknown) | undefined =
  typeof hostSetImmediate === "function" ? hostSetImmediate : undefined;

/**
 * The answers as a plain list, each read once, or a throw when the list does
 * not hold one answer per input. Reading them here, before any reader is
 * settled, means an answer that throws as it is read, as a getter or a proxy
 * can, fails the call as a throwing method would.
 */
function answersFor(answers: unknown, count: number, label: string): unknown[] {
  const inputs = `${count} input${count === 1 ? "" : "s"}`;
  const values: unknown[] = [];
  try {
    // The length is read once, so a list cannot answer two lengths.
    const length = Array.isArray(answers) ? answers.length : undefined;
    if (length !== count) {
      const returned =
        length !== undefined
          ? `${length} answer${length === 1 ? "" : "s"}`
          : answers === null
            ? "null"
            : typeof answers;
      throw new Error(
        `Batched query ${label} returned ${returned} for ${inputs}; ` +
          "it must return one answer per input, in the same order.",
      );
    }
    const list = answers as unknown[];
    for (let index = 0; index < count; index += 1) {
      if (!(index in list)) {
        throw new Error(
          `Batched query ${label} left answer ${index + 1} of ${inputs} empty; ` +
            "it must return one answer per input, in the same order.",
        );
      }
      values.push(list[index]);
    }
    return values;
  } catch (error) {
    quiet(answers, values);
    throw error;
  }
}

/** Answer one input at a time through a batched query's list form. */
export function batchedQuery(
  list: ListForm,
  label: string,
  grouped: boolean,
): (input: unknown) => Promise<unknown> {
  const call = (inputs: unknown[], count: number): Promise<unknown[]> =>
    Promise.resolve()
      .then(() => list(Object.freeze(inputs)))
      .then((answers) => answersFor(answers, count, label));
  // Each input is kept as it was asked, so a caller changing its object later
  // changes nothing: records, arrays and dates are copied, other objects kept.
  if (!grouped || nextTurn === undefined) {
    return async (input) => (await call([snapshotValue(input)], 1))[0];
  }

  let pending: PendingRead[] | undefined;

  // A failed group is read again as lists of one, all at once, as the reads
  // would have gone ungrouped, so a bad input fails only its own read and a
  // slow one delays only its own. Each read keeps the copy taken when it was
  // asked, and the group's call got copies of those, so a call that changed
  // its inputs before failing leaves the reads again unchanged.
  // Every read is under way before the warning, so a warning that throws, as in
  // a test that fails on warnings, cannot leave a read unsettled.
  const readEachAlone = (group: PendingRead[], error: unknown): void => {
    for (const read of group) {
      call([read.input], 1).then(([answer]) => read.resolve(answer), read.reject);
    }
    try {
      logger.warn(`Batched query ${label} failed for ${group.length} inputs; reading each alone.`, {
        error: serializeError(error),
      });
    } catch {
      // The reads go on without the warning.
    }
  };

  const flush = (group: PendingRead[]): void => {
    // A group of more than one is called with copies, kept apart from the
    // inputs a read again alone would pass.
    let inputs: unknown[];
    try {
      inputs =
        group.length === 1 ? [group[0].input] : group.map(({ input }) => snapshotValue(input));
    } catch (error) {
      readEachAlone(group, error);
      return;
    }
    call(inputs, group.length).then(
      (answers) => group.forEach((read, index) => read.resolve(answers[index])),
      (error: unknown) => {
        if (group.length === 1) group[0].reject(error);
        else readEachAlone(group, error);
      },
    );
  };

  return async (input: unknown) => {
    const copy = snapshotValue(input);
    return new Promise((resolve, reject) => {
      if (pending === undefined) {
        const group: PendingRead[] = [];
        pending = group;
        nextTurn(() => {
          pending = undefined;
          flush(group);
        });
      }
      pending.push({ input: copy, resolve, reject });
    });
  };
}
