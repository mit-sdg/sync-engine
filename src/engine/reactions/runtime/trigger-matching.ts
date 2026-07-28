/** Join one landed occurrence with an executable reaction's trigger clauses. */

import { Frames } from "@engine/reads/frames";
import type { ActionConcept, ActionRecord } from "./actions.ts";
import { flow, landing } from "../context.ts";
import type { ChannelPattern, ChannelPosture, ExecutableReaction, Frame } from "../types.ts";
import { matchArguments, matchChannel, postureOfOutcome } from "./matching.ts";

export class TriggerMatcher {
  constructor(
    private readonly records: Pick<ActionConcept, "_getByFlow" | "_getById" | "_matchingRecord">,
    private readonly consumption: {
      hasConsumed(recordId: string | undefined, reaction: string): boolean;
    },
    private readonly rawConceptOf: (instrumented: object) => object,
  ) {}

  match(record: ActionRecord, reaction: ExecutableReaction): [Frames<Frame>, symbol[]] {
    const landed = this.records._matchingRecord(
      (record.id !== undefined ? this.records._getById(record.id) : undefined) ?? record,
    );
    const seed = { [flow]: record.flow, [landing]: record.id } as Frame;

    if (reaction.when.length === 1) {
      const clause = reaction.when[0];
      const actionSymbol = Symbol("action_0");
      if (this.consumption.hasConsumed(landed.id, reaction.name)) {
        return [new Frames(), [actionSymbol]];
      }
      const matched =
        "channel" in clause
          ? this.matchChannel(landed, clause, seed, actionSymbol)
          : matchArguments(landed, clause, seed, actionSymbol);
      return [matched === undefined ? new Frames() : new Frames(matched), [actionSymbol]];
    }

    const flowActions = this.records._getByFlow(record.flow);
    if (flowActions === undefined) return [new Frames(), []];
    let framesWithConsumed: [Frame, Set<string>][] = [[seed, new Set()]];
    const actionSymbols: symbol[] = [];

    reaction.when.forEach((clause, index) => {
      const actionSymbol = Symbol(`action_${index}`);
      actionSymbols.push(actionSymbol);
      const next: [Frame, Set<string>][] = [];
      for (const [frame, parentConsumed] of framesWithConsumed) {
        for (const candidate of flowActions) {
          if (this.consumption.hasConsumed(candidate.id, reaction.name)) continue;
          if (candidate.id !== undefined && parentConsumed.has(candidate.id)) continue;
          const matchingCandidate = this.records._matchingRecord(candidate);
          const matched =
            "channel" in clause
              ? this.matchChannel(matchingCandidate, clause, frame, actionSymbol)
              : matchArguments(matchingCandidate, clause, frame, actionSymbol);
          if (matched === undefined) continue;
          const childConsumed = new Set(parentConsumed);
          if (candidate.id !== undefined) childConsumed.add(candidate.id);
          next.push([matched, childConsumed]);
        }
      }
      framesWithConsumed = next;
    });
    return [new Frames(...framesWithConsumed.map(([frame]) => frame)), actionSymbols];
  }

  posture(record: ActionRecord): ChannelPosture | undefined {
    const stored = record.id !== undefined ? this.records._getById(record.id) : undefined;
    const fault = stored?.fault ?? record.fault;
    const outcome = stored?.outcome ?? record.outcome;
    return fault !== undefined
      ? "faulted"
      : outcome === undefined
        ? undefined
        : postureOfOutcome(outcome);
  }

  matchChannel(
    record: ActionRecord,
    clause: ChannelPattern,
    frame: Frame,
    actionSymbol: symbol,
  ): Frame | undefined {
    return matchChannel(this.records._matchingRecord(record), clause, frame, actionSymbol, {
      get: (candidate) => this.rawConceptOf(candidate),
    });
  }
}
