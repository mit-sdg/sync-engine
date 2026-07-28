/** Join one landed occurrence with an executable reaction's trigger clauses. */

import { Frames } from "@engine/reads/frames";
import type { ActionConcept, ActionRecord } from "./actions.ts";
import { flow, landing } from "../context.ts";
import type { ChannelPattern, ChannelPosture, ExecutableReaction, Frame } from "../types.ts";
import { matchArguments, matchChannel, postureOfOutcome } from "./matching.ts";

function cloneMatchValue(value: unknown, seen: WeakMap<object, object>): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  const cloned: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value)
    ? []
    : Object.create(prototype);
  if (Array.isArray(cloned)) cloned.length = (value as unknown[]).length;
  seen.set(value, cloned);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) continue;
    Object.defineProperty(cloned, key, {
      get() {
        const source = "value" in descriptor ? descriptor.value : Reflect.get(value, key, value);
        const result = cloneMatchValue(source, seen);
        Object.defineProperty(cloned, key, {
          value: result,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        return result;
      },
      set(next) {
        Object.defineProperty(cloned, key, {
          value: next,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      },
      enumerable: true,
      configurable: true,
    });
  }
  return cloned;
}

function snapshotRecord(record: ActionRecord, seen: WeakMap<object, object>): ActionRecord {
  return {
    ...record,
    input: cloneMatchValue(record.input, seen) as Record<string, unknown>,
    ...(record.output === undefined
      ? {}
      : { output: cloneMatchValue(record.output, seen) as Record<string, unknown> }),
    ...(record.outcome === undefined
      ? {}
      : { outcome: cloneMatchValue(record.outcome, seen) as ActionRecord["outcome"] }),
    ...(record.fault === undefined
      ? {}
      : { fault: cloneMatchValue(record.fault, seen) as Record<string, unknown> }),
  };
}

export class TriggerMatcher {
  constructor(
    private readonly records: Pick<ActionConcept, "_getByFlow" | "_getById" | "_matchingRecord">,
    private readonly consumption: {
      hasConsumed(recordId: string | undefined, reaction: string): boolean;
    },
    private readonly rawConceptOf: (instrumented: object) => object,
    private readonly assertRows?: (flow: string, count: number) => void,
  ) {}

  match(record: ActionRecord, reaction: ExecutableReaction): [Frames<Frame>, symbol[]] {
    const snapshots = new WeakMap<object, object>();
    const landed = snapshotRecord(
      this.records._matchingRecord(
        (record.id !== undefined ? this.records._getById(record.id) : undefined) ?? record,
      ),
      snapshots,
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
      if (matched !== undefined) this.assertRows?.(record.flow, 1);
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
          const matchingCandidate = snapshotRecord(
            this.records._matchingRecord(candidate),
            snapshots,
          );
          const matched =
            "channel" in clause
              ? this.matchChannel(matchingCandidate, clause, frame, actionSymbol)
              : matchArguments(matchingCandidate, clause, frame, actionSymbol);
          if (matched === undefined) continue;
          const childConsumed = new Set(parentConsumed);
          if (candidate.id !== undefined) childConsumed.add(candidate.id);
          this.assertRows?.(record.flow, next.length + 1);
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
    return matchChannel(record, clause, frame, actionSymbol, {
      get: (candidate) => this.rawConceptOf(candidate),
    });
  }
}
