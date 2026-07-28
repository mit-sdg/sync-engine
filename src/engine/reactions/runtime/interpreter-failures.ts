/** Record sanitized failures produced between instrumented action asks. */

import { serializeError } from "@engine/utils/redaction";
import type { ActionConcept } from "./actions.ts";
import type { ReactionFailureRecord } from "./log-store.ts";

export class InterpreterFailures {
  constructor(private readonly actions: Pick<ActionConcept, "_recordReactionFailure">) {}

  record(
    reaction: string,
    flow: string,
    triggerIds: string[],
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    consequence: Pick<ReactionFailureRecord, "action" | "actionId"> = {},
  ): void {
    const serialized = serializeError(error);
    this.actions._recordReactionFailure({
      reaction,
      flow,
      triggerIds,
      stage,
      ...consequence,
      errorClass: typeof serialized.name === "string" ? serialized.name : "Error",
      at: Date.now(),
    });
  }
}
