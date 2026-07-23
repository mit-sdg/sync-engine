/**
 * The **`Refuse` marker** — the implementation-language spelling of a
 * concept's declared refuse branch, the way `return` spells the success
 * branch.
 *
 * A concept implementation refuses by `throw new Refuse(message, data?)`.
 * Instrumentation catches it and records a refusal with its message and data.
 * Any other throw is a runtime fault and does not create an action outcome.
 *
 * This module is deliberately dependency-light so concept classes stay
 * otherwise plain. Recognition uses a registered marker symbol rather than
 * `instanceof`, so a `Refuse` thrown across realms (or from a duplicated
 * module instance) is recognized.
 */

const RefuseMarker = Symbol.for("sync-engine.refuse");

export class Refuse extends Error {
  /** Extra fields carried alongside the message (e.g. a human-readable detail). */
  readonly data?: Record<string, unknown>;

  constructor(message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "Refuse";
    if (data !== undefined) this.data = data;
    Object.defineProperty(this, RefuseMarker, { value: true, enumerable: false });
  }
}

/** Cross-realm-safe recognition: the marker property, not `instanceof`. */
export function isRefuse(value: unknown): value is Refuse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[RefuseMarker] === true
  );
}

/**
 * The refusal as recorded on the log: the marker's data spread under the
 * message. The message always wins the `error` key — it is the refusal's
 * declared code, and data may not override it.
 */
export function refusalMapping(refusal: Refuse): Record<string, unknown> {
  return { ...refusal.data, error: refusal.message };
}
