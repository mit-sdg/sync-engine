import { isPlainMapping } from "@engine/reads/matchers";
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
  ActionTriggerPattern,
  ChannelPattern,
  ChannelPosture,
  ExecutableReaction,
  Frame,
  InstrumentedAction,
  Mapping,
} from "../types.ts";

/** The posture in which an action outcome landed. */
function postureOfOutcome(outcome: ActionOutcome): ChannelPosture {
  return outcome.kind === "result" ? "returned" : "refused";
}

/** Cached regular expressions for serialized `$regexp` markers. */
const regexpOf = new WeakMap<object, RegExp>();

function literalCandidate(value: unknown, markers = true): unknown {
  if (Array.isArray(value)) return value.map((item) => literalCandidate(item));
  if (!isPlainMapping(value)) return value;
  if (markers) {
    const marker = asMarker(value);
    if (marker?.tag === "$lit") return literalCandidate(marker.payload, false);
    if (marker?.tag === "$is") return liveOf(value) ?? value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, literalCandidate(item)]),
  );
}

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
 * `$oneOf`, `$regexp`, `$lit`, and `$is` with a definition-site value. Other
 * values are matched with the structural equality shared by reads and formers. Object literals do
 * not bind variables recursively.
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
      else if (!structurallyEqual(next[variable], recordValue)) return undefined;
      continue;
    }
    if (value instanceof RegExp) {
      if (!testRegExp(value, recordValue)) return undefined;
      continue;
    }
    const marker =
      typeof value === "object" && value !== null && !Array.isArray(value) ? asMarker(value) : null;
    if (marker !== null) {
      switch (marker.tag) {
        case "$oneOf": {
          if (
            !(marker.payload as unknown[]).some((candidate) =>
              structurallyEqual(literalCandidate(candidate), recordValue),
            )
          ) {
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
          if (live === undefined || !structurallyEqual(recordValue, live)) return undefined;
          continue;
        }
        case "$lit": {
          if (!structurallyEqual(recordValue, marker.payload)) return undefined;
          continue;
        }
        default:
          break;
      }
    }
    if (!structurallyEqual(recordValue, value)) return undefined;
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

/** Whether a record has the trigger's action, provenance, and posture. */
function admits(record: ActionRecord, pattern: ActionTriggerPattern): boolean {
  if (record.concept !== pattern.concept || record.action !== pattern.action) return false;
  if (pattern.by !== undefined && record.by !== pattern.by) return false;
  switch (pattern.posture) {
    case undefined:
      return true;
    case "requested":
      return record.outcome === undefined && record.fault === undefined;
    case "faulted":
      return record.fault !== undefined;
    default:
      return record.outcome !== undefined && postureOfOutcome(record.outcome) === pattern.posture;
  }
}

/**
 * Whether a trigger clause or `earlier` line can match a record before it is copied: action,
 * provenance, posture, and input on the record as stored. The stored input is the ask's own
 * snapshot (once its flow has ended, the redacted store copy), and no user code holds it:
 * triggers and `earlier` bind copies, observers and logs read redacted projections, and only
 * the engine's own observer filters see the record, reading its concept, action, and outcome.
 * So it unifies as its copy would against frames holding no copy of this record. Channel
 * clauses are left to the full match.
 */
function mayMatch(
  record: ActionRecord,
  clause: ActionTriggerPattern | ChannelPattern,
  frame: Frame,
): boolean {
  if ("channel" in clause) return true;
  if (!admits(record, clause)) return false;
  return unifyPattern(record.input, clause.input, frame) !== undefined;
}

/** Match action identity, provenance, posture, input, and output for one trigger. */
export function matchArguments(
  record: ActionRecord,
  pattern: ActionTriggerPattern,
  frame: Frame,
  recordBinding: symbol,
): Frame | undefined {
  if (!admits(record, pattern)) return undefined;
  let next = unifyPattern(record.input, pattern.input, frame);
  if (next === undefined) return undefined;
  if (pattern.posture === "requested") return { ...next, [recordBinding]: record.id };
  const outcome =
    pattern.posture === "faulted"
      ? ({ kind: "result", value: record.fault ?? {} } as const)
      : record.outcome;
  if (outcome === undefined) return undefined;
  if (Object.keys(pattern.output).length === 0 && outcome.kind === "error") return undefined;
  next =
    pattern.posture === "refused" && outcome.kind === "error"
      ? unifyPattern(
          {
            ...outcome.error,
            ...(outcome.error.error !== undefined ? { message: outcome.error.error } : {}),
          },
          pattern.output,
          next,
        )
      : unifyOutputPattern(outcome, pattern.output, next);
  return next === undefined ? undefined : { ...next, [recordBinding]: record.id };
}

/**
 * Match a stored record as a trigger does: action, provenance, posture, and input on the
 * record as stored, then the values matching reads on a copy taken through `seen`, so the
 * values a match binds are the reaction's own and repeated references stay shared within one
 * `seen`. A record this `seen` already copied is tested on that copy alone, since frames may
 * hold values from it that equal only themselves, such as an invalid `Date`.
 */
export function matchRecordCopy(
  record: ActionRecord,
  pattern: ActionTriggerPattern,
  frame: Frame,
  recordBinding: symbol,
  seen: WeakMap<object, unknown>,
): Frame | undefined {
  if (!seen.has(record.input) && !mayMatch(record, pattern, frame)) return undefined;
  return matchArguments(snapshotRecord(record, seen), pattern, frame, recordBinding);
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

/** Copy the values matching reads; the `output`, which it never reads, is left out. */
function snapshotRecord(record: ActionRecord, seen: WeakMap<object, unknown>): ActionRecord {
  const { output: _output, ...matched } = record;
  return {
    ...matched,
    input: snapshotValue(record.input, seen) as Record<string, unknown>,
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
      hasConsumed(recordId: string, reaction: string): boolean;
    },
    private readonly rawConceptOf: (instrumented: object) => object,
    private readonly assertRows?: (flow: string, count: number) => void,
  ) {}

  /**
   * Each action clause is tested on the record's action, provenance, posture, and stored input
   * first, and only a record that passes is copied (a channel clause copies every candidate), so
   * a reaction's frames hold its own copy and a rejected one copies nothing.
   */
  match(record: ActionRecord, reaction: ExecutableReaction): [Frames<Frame>, symbol[]] {
    const snapshots = new WeakMap<object, unknown>();
    const seed = { [flow]: record.flow, [landing]: record.id } as Frame;

    if (reaction.when.length === 1) {
      const clause = reaction.when[0];
      const actionSymbol = Symbol("action_0");
      const stored = this.records._matchingRecord(this.records._getById(record.id) ?? record);
      if (
        this.consumption.hasConsumed(stored.id, reaction.name) ||
        !mayMatch(stored, clause, seed)
      ) {
        return [new Frames(), [actionSymbol]];
      }
      const landed = snapshotRecord(stored, snapshots);
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
          if (parentConsumed.has(candidate.id)) continue;
          const stored = this.records._matchingRecord(candidate);
          if (!mayMatch(stored, clause, frame)) continue;
          const matchingCandidate = snapshotRecord(stored, snapshots);
          const matched =
            "channel" in clause
              ? this.matchChannel(matchingCandidate, clause, frame, actionSymbol)
              : matchArguments(matchingCandidate, clause, frame, actionSymbol);
          if (matched === undefined) continue;
          const childConsumed = new Set(parentConsumed);
          childConsumed.add(candidate.id);
          this.assertRows?.(record.flow, next.length + 1);
          next.push([matched, childConsumed]);
        }
      }
      framesWithConsumed = next;
    });
    return [new Frames(...framesWithConsumed.map(([frame]) => frame)), actionSymbols];
  }

  posture(record: ActionRecord): ChannelPosture | undefined {
    const stored = this.records._getById(record.id);
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
