/**
 * Handling answers no reader will take, so that none rejects unhandled. Bun,
 * and Node by default, end the process on an unhandled rejection.
 */
const ignore = (): void => {};

/** Handle one answer no reader will take, if it can reject; nothing it does escapes. */
function handle(answer: unknown): void {
  if (answer === null || (typeof answer !== "object" && typeof answer !== "function")) return;
  try {
    // The intrinsic then handles a native promise whatever own `then` it carries,
    // and throws at once for anything else.
    void Promise.prototype.then.call(answer, undefined, ignore);
    return;
  } catch {
    // Not a native promise: handle it as a thenable, if it is one.
  }
  try {
    if (typeof (answer as { then?: unknown }).then === "function") {
      Promise.resolve(answer).catch(ignore);
    }
  } catch {
    // A thenable that throws as it is handled has nothing more to handle.
  }
}

/**
 * Handle every answer in a list no reader will take, so none rejects unhandled:
 * first the answers already read, since a getter may make a new one each time,
 * then the list's other entries, each on its own, so one that throws as it is
 * read does not stop the rest. The entries are listed once, so a list that grows
 * as it is read cannot keep this going.
 */
export function quiet(answers: unknown, taken: readonly unknown[] = []): void {
  for (const answer of taken) handle(answer);
  let keys: string[];
  try {
    keys = Array.isArray(answers) ? Object.keys(answers) : [];
  } catch {
    return;
  }
  for (const key of keys) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < taken.length) continue;
    try {
      handle((answers as unknown[])[index]);
    } catch {
      // This entry throws as it is read; the rest may still need handling.
    }
  }
}
