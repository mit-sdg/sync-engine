/**
 * Standard refusal and fault delivery for an application boundary.
 *
 * A refused action answers the root request with its registered code. A
 * runtime fault answers with `INTERNAL_ERROR`. Fault log records use a fixed
 * message plus `action`, `actionId` when available, and the exception class;
 * the instrumentation fallback also includes `concept`. The logger adds
 * `level` and `timestamp`.
 * The request boundary enforces one answer and refuses a second response with
 * `NOT_PENDING`.
 *
 * The refusal reaction skips the request-boundary actions so a `NOT_PENDING`
 * refusal cannot recurse. The fault reaction skips asks made by its own
 * {@link FAULT_REACTION}. It also observes faults while forming a boundary
 * response, because those faults must answer the root request when possible.
 */

import type { ActionTriggerIR, ChannelTriggerIR, PatternIR, ReactionIR } from "@engine/reads/ir";

/** The generic public reply for an internal runtime fault. */
export const FAULT_REPLY = "INTERNAL_ERROR";

/** The registered fault-delivery reaction name used by its provenance guard. */
export const FAULT_REACTION = "DeliverFaultToAsker";

/** Fresh canonical IR used for both runtime registration and static proof. */
export function standardBoundaryOutcomeReactions(): ReactionIR[] {
  const requestId = { $var: "requestId" } as const;
  const request: ActionTriggerIR = {
    kind: "action",
    concept: "RequestBoundary",
    action: "request",
    input: { requestId },
    output: {},
  };
  const outcome = (
    name: string,
    when: ChannelTriggerIR,
    action: string,
    input: PatternIR,
  ): ReactionIR => ({
    name,
    when: [when],
    where: [{ op: "earlier", when: request }],
    then: [{ kind: "request", concept: "RequestBoundary", action, input }],
  });
  return [
    outcome(
      "DeliverRefusalToAsker",
      {
        kind: "channel",
        channel: "refused",
        pattern: { message: { $var: "message" } },
        except: ["RequestBoundary"],
      },
      "respond",
      { requestId, error: { $var: "message" } },
    ),
    outcome(
      FAULT_REACTION,
      {
        kind: "channel",
        channel: "faulted",
        pattern: {},
        except: [],
        exceptBy: [FAULT_REACTION],
      },
      "respondFramework",
      { requestId, error: FAULT_REPLY },
    ),
  ];
}
