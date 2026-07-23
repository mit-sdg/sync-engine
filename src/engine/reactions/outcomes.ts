/**
 * **Declared outcomes** — a static, per-action contract carried on the
 * concept class.
 *
 * A concept's spec already says how each action can resolve: a return branch
 * and zero or more refuse branches, each with its message. Declaring those
 * here makes the contract available to instrumentation and the specification
 * renderer:
 *
 * ```ts
 * class InvitingConcept {
 *   static readonly outcomes: OutcomeContracts = {
 *     accept: { refusals: ["NO_LONGER_OPEN"] },
 *   };
 *   accept({ invitation }: { invitation: string }) { … }
 * }
 * ```
 *
 * A contracted action's returned mapping is always a result, even when it has
 * an `error` key. Throwing `Refuse` produces a refusal and checks its code
 * against this declaration.
 */

import { conceptMetadataOf } from "./concept-metadata.ts";

/** The declared resolution contract of one action. */
export interface ActionContract {
  /** The refusal codes this action's spec declares (its refuse branches). */
  refusals?: readonly string[];
}

/** Per-action contracts, keyed by action (method) name. */
export type OutcomeContracts = Record<string, ActionContract>;

/** Look up the declared contract for one action of a concept instance. */
export function contractOf(concept: object, action: string): ActionContract | undefined {
  const metadata = conceptMetadataOf(concept);
  const declared = metadata?.outcomes?.[action];
  const refusalCodes = metadata?.refusals?.[action]
    ? Object.keys(metadata.refusals[action])
    : undefined;
  if (declared !== undefined || refusalCodes !== undefined) {
    return { ...declared, ...(refusalCodes !== undefined ? { refusals: refusalCodes } : {}) };
  }
  const outcomes = (concept.constructor as { outcomes?: OutcomeContracts }).outcomes;
  if (outcomes === undefined || typeof outcomes !== "object") return undefined;
  return outcomes[action];
}
