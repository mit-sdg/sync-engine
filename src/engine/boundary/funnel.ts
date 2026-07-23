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

import {
  earlier,
  faulted,
  reaction,
  refused,
  type Reaction,
  type Vars,
  when,
} from "../reactions/index.ts";
import { actionLine } from "../reactions/nodes.ts";
import type { RequestBoundaryActions } from "./endpoints.ts";
import { FRAMEWORK_ERROR_KIND_FIELD } from "./errors.ts";

/** The generic public reply for an internal runtime fault. */
export const FAULT_REPLY = "INTERNAL_ERROR";

/** The registered fault-delivery reaction name used by its provenance guard. */
export const FAULT_REACTION = "DeliverFaultToAsker";

export function refusalFunnel(boundary: RequestBoundaryActions): Record<string, Reaction> {
  const except = [boundary.request, boundary.respond];

  const DeliverRefusalToAsker = reaction(({ requestId, message }: Vars) =>
    when(refused({ message }, { except }))
      .where(earlier(boundary.request, { requestId }))
      .then(actionLine(boundary.respond, { requestId, error: message }) as never),
  );

  const DeliverFaultToAsker = reaction(({ requestId }: Vars) =>
    when(faulted({}, { exceptBy: [FAULT_REACTION] }))
      .where(earlier(boundary.request, { requestId }))
      .then(
        actionLine(boundary.respond, {
          requestId,
          error: FAULT_REPLY,
          [FRAMEWORK_ERROR_KIND_FIELD]: "framework",
        }) as never,
      ),
  );

  return { DeliverRefusalToAsker, [FAULT_REACTION]: DeliverFaultToAsker };
}
