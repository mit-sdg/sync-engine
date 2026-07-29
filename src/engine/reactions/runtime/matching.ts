import { isMatcher } from "@engine/reads/matchers";
import { Frames } from "@engine/reads/frames";
import { snapshotValue } from "@engine/utils/snapshot";
import { varKeyOf } from "@engine/reads/frames";
import { structurallyEqual } from "@engine/reads/value-equality";
import { asMarker, liveOf } from "@engine/reads/ir";
import { actionNameOf, conceptNameOf } from "../concepts/introspect.ts";
import type { ActionConcept, ActionRecord } from "./actions.ts";
import { flow, landing } from "../context.ts";
import type {
  ActionOutcome,
  ActionPattern,
  ChannelPattern,
  ChannelPosture,
  ExecutableReaction,
  Frame,
  InstrumentedAction,
  Mapping,
} from "../types.ts";

/** The posture in which an action outcome landed. */
export function postureOfOutcome(outcome: ActionOutcome): ChannelPosture {
  return outcome.kind === "result" ? "returned" : "refused";
}

/** Compare literal values with the same equality used by reads and formers. */
export const literalEquals = structurallyEqual;

/** Cached regular expressions for serialized `$regexp` markers. */
const regexpOf = new WeakMap<object, RegExp>();

function testRegExp(pattern: RegExp, recordValue: unknown): boolean {
  if (typeof recordValue !== "string") return false;
  pattern.lastIndex = 0;
  const matched = pattern.test(recordValue);
  pattern.lastIndex = 0;
  return matched;
}

/**
 * Match each stated field against a record and extend the supplied frame.
 * Accepted field patterns are authored variables, `{ $var }`, `RegExp`,
 * authored candidate matchers, `$oneOf`, `$regexp`, `$lit`, and `$is` with a
 * definition-site value. Other values are matched as literals by
 * {@link literalEquals}. Object literals do not bind variables recursively.
 */
export function unifyPattern(
  recordValues: Record<string, unknown>,
  pattern: Record<string, unknown>,
  frame: Frame,
): Frame | undefined {
  let next = frame;
  for (const [key, value] of Object.entries(pattern)) {
    const variable = varKeyOf(value);
    if (!Object.hasOwn(recordValues, key)) return undefined;
    const recordValue = recordValues[key];
    if (variable !== undefined) {
      if (!Object.hasOwn(next, variable)) next = { ...next, [variable]: recordValue };
      else if (!literalEquals(next[variable], recordValue)) return undefined;
      continue;
    }
    if (value instanceof RegExp) {
      if (!testRegExp(value, recordValue)) return undefined;
      continue;
    }
    if (isMatcher(value)) {
      if (!value.candidates?.some((candidate) => candidate === recordValue)) return undefined;
      continue;
    }
    const marker =
      typeof value === "object" && value !== null && !Array.isArray(value) ? asMarker(value) : null;
    if (marker !== null) {
      switch (marker.tag) {
        case "$oneOf": {
          if (!(marker.payload as unknown[]).some((candidate) => candidate === recordValue)) {
            return undefined;
          }
          continue;
        }
        case "$regexp": {
          let compiled = regexpOf.get(value as object);
          if (compiled === undefined) {
            const { source, flags } = marker.payload as { source: string; flags: string };
            compiled = new RegExp(source, flags);
            regexpOf.set(value as object, compiled);
          }
          if (!testRegExp(compiled, recordValue)) return undefined;
          continue;
        }
        case "$is": {
          const live = liveOf(value as object);
          if (live === undefined || !literalEquals(recordValue, live)) return undefined;
          continue;
        }
        case "$lit": {
          if (!literalEquals(recordValue, marker.payload)) return undefined;
          continue;
        }
        default:
          break;
      }
    }
    if (!literalEquals(recordValue, value)) return undefined;
  }
  return next;
}

export function unifyOutputPattern(
  outcome: ActionOutcome,
  pattern: Mapping,
  frame: Frame,
): Frame | undefined {
  return unifyPattern(outcome.kind === "result" ? outcome.value : outcome.error, pattern, frame);
}

/** Match action identity, provenance, posture, input, and output for one trigger. */
export function matchArguments(
  record: ActionRecord,
  pattern: ActionPattern,
  frame: Frame,
  recordBinding: symbol,
): Frame | undefined {
  if (record.concept !== pattern.concept || record.action !== pattern.action) return undefined;
  if (pattern.by !== undefined && record.by !== pattern.by) return undefined;
  if (pattern.posture === "requested") {
    const next = unifyPattern(record.input, pattern.input, frame);
    return next === undefined ? undefined : { ...next, [recordBinding]: record.id };
  }
  if (pattern.posture !== undefined) {
    if (pattern.posture === "faulted") {
      if (record.fault === undefined) return undefined;
    } else if (
      record.outcome === undefined ||
      postureOfOutcome(record.outcome) !== pattern.posture
    ) {
      return undefined;
    }
  }

  let next = unifyPattern(record.input, pattern.input, frame);
  if (next === undefined) return undefined;
  if (pattern.output === undefined) {
    throw new Error(`When pattern: ${String(pattern)} is missing output pattern.`);
  }
  if (record.outcome === undefined) return undefined;
  if (Object.keys(pattern.output).length === 0 && record.outcome.kind === "error") return undefined;
  next =
    pattern.posture === "refused" && record.outcome.kind === "error"
      ? unifyPattern(
          {
            ...record.outcome.error,
            ...(record.outcome.error.error !== undefined
              ? { message: record.outcome.error.error }
              : {}),
          },
          pattern.output,
          next,
        )
      : unifyOutputPattern(record.outcome, pattern.output, next);
  return next === undefined ? undefined : { ...next, [recordBinding]: record.id };
}

function isExcepted(
  clause: ChannelPattern,
  recordConcept: object,
  rawConceptsByInstrumented: { get(candidate: object): object | undefined },
): boolean {
  for (const entry of clause.except) {
    const candidate =
      typeof entry === "function" ? ((entry as InstrumentedAction).concept ?? entry) : entry;
    const raw = rawConceptsByInstrumented.get(candidate) ?? candidate;
    if (raw === recordConcept) return true;
  }
  return false;
}

/** Match one record against a posture channel, exclusions, provenance, and payload pattern. */
export function matchChannel(
  record: ActionRecord,
  clause: ChannelPattern,
  frame: Frame,
  recordBinding: symbol,
  rawConceptsByInstrumented: { get(candidate: object): object | undefined },
): Frame | undefined {
  let payloadKey: string;
  let payload: Mapping;
  if (clause.channel === "faulted") {
    if (record.fault === undefined) return undefined;
    payloadKey = "fault";
    payload = record.fault;
  } else {
    if (record.outcome === undefined || postureOfOutcome(record.outcome) !== clause.channel) {
      return undefined;
    }
    payloadKey = clause.channel === "returned" ? "result" : "refusal";
    payload = record.outcome.kind === "result" ? record.outcome.value : record.outcome.error;
  }
  if (isExcepted(clause, record.concept, rawConceptsByInstrumented)) return undefined;
  if (
    clause.exceptBy !== undefined &&
    record.by !== undefined &&
    clause.exceptBy.includes(record.by)
  ) {
    return undefined;
  }
  if (clause.by !== undefined && record.by !== clause.by) return undefined;

  const synthesized: Mapping = {
    concept: conceptNameOf(record.concept),
    action: actionNameOf(record.action),
    input: record.input,
    [payloadKey]: payload,
    ...(clause.channel === "refused" ? { message: payload.error } : {}),
  };
  const unified = unifyPattern(synthesized, clause.pattern, frame);
  return unified === undefined ? undefined : { ...unified, [recordBinding]: record.id };
}

function snapshotRecord(record: ActionRecord, seen: WeakMap<object, unknown>): ActionRecord {
  return {
    ...record,
    input: snapshotValue(record.input, seen) as Record<string, unknown>,
    ...(record.output === undefined
      ? {}
      : { output: snapshotValue(record.output, seen) as Record<string, unknown> }),
    ...(record.outcome === undefined
      ? {}
      : { outcome: snapshotValue(record.outcome, seen) as ActionRecord["outcome"] }),
    ...(record.fault === undefined
      ? {}
      : { fault: snapshotValue(record.fault, seen) as Record<string, unknown> }),
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
    const snapshots = new WeakMap<object, unknown>();
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
