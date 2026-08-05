/**
 * **Settlement frontiers** — the deferred half of reaction firing.
 *
 * An ordinary reaction prepares its firing where its trigger lands. A
 * *deferred* trigger (`.afterFlowSettles()`) is armed there instead and waits
 * for a settlement frontier: the moment a flow's outermost ask is about to
 * settle, when every ordinary cascade the flow started has drained but its
 * occurrences, bindings, and transient matching values are still alive.
 *
 * This book holds one armed list per flow. A frontier qualifies each armed
 * trigger against current state: one that fires is retired, one whose
 * conditions do not hold stays armed for a later frontier of the same flow,
 * and the whole list is discarded when the flow finalizes. The anchor
 * occurrence a trigger matched keeps supplying the landing position and the
 * consumption identity, so a deferred reaction fires at most once per anchor
 * exactly as an ordinary one does.
 */

import type { ExecutableReaction } from "../types.ts";
import type { MatchedTrigger } from "./firing-pipeline.ts";

/** Whether a reaction holds its consequence for a settlement frontier. */
export function isDeferred(reaction: ExecutableReaction): boolean {
  return reaction.then[0]?.deferred === true;
}

/** Owns the deferred triggers armed in each active flow. */
export class SettlementBook {
  private readonly armedByFlow = new Map<string, MatchedTrigger[]>();

  /** Hold one matched deferred trigger for its flow's next frontier. */
  arm(flow: string, matched: MatchedTrigger): void {
    const armed = this.armedByFlow.get(flow);
    if (armed === undefined) this.armedByFlow.set(flow, [matched]);
    else armed.push(matched);
  }

  /** Whether the flow still has an armed trigger to consider. */
  has(flow: string): boolean {
    return this.armedByFlow.has(flow);
  }

  /** The triggers one frontier considers, in the order they were armed. */
  pending(flow: string): MatchedTrigger[] {
    return [...(this.armedByFlow.get(flow) ?? [])];
  }

  /** Retire one armed trigger whose firing this frontier prepared. */
  retire(flow: string, matched: MatchedTrigger): void {
    const armed = this.armedByFlow.get(flow);
    if (armed === undefined) return;
    const position = armed.indexOf(matched);
    if (position >= 0) armed.splice(position, 1);
    if (armed.length === 0) this.armedByFlow.delete(flow);
  }

  /** Drop everything armed in a flow that is finalizing. */
  discard(flow: string): void {
    this.armedByFlow.delete(flow);
  }

  /** Number of flows holding an armed trigger. */
  get size(): number {
    return this.armedByFlow.size;
  }
}
