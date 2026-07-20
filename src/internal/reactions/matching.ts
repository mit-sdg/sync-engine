import { isMatcher } from "../reads/matchers.ts";
import { varKeyOf } from "../reads/frames.ts";
import { asMarker, liveOf } from "../reads/ir.ts";
import { actionNameOf, conceptNameOf } from "./introspect.ts";
import type { ActionRecord } from "./actions.ts";
import type {
  ActionOutcome,
  ActionPattern,
  ChannelPattern,
  ChannelPosture,
  Frame,
  InstrumentedAction,
  Mapping,
} from "./types.ts";

/** Reserved bindings carried beside application variables in an interpreter frame. */
export const flow = Symbol("flow");
export const actionId = Symbol("actionId");
export const byReaction = Symbol("byReaction");
export const landing = Symbol("landing");

/** The posture in which an action outcome landed. */
export function postureOfOutcome(outcome: ActionOutcome): ChannelPosture {
  return outcome.kind === "result" ? "returned" : "refused";
}

/** Compare literal arrays and records recursively, including their exact key sets. */
export function literalEquals(recordValue: unknown, literal: unknown): boolean {
  if (recordValue === literal) return true;
  if (Array.isArray(literal)) {
    return (
      Array.isArray(recordValue) &&
      literal.length === recordValue.length &&
      literal.every((item, index) => literalEquals(recordValue[index], item))
    );
  }
  if (
    literal !== null &&
    typeof literal === "object" &&
    recordValue !== null &&
    typeof recordValue === "object" &&
    !Array.isArray(recordValue)
  ) {
    const literalKeys = Object.keys(literal);
    const recordKeys = Object.keys(recordValue);
    return (
      literalKeys.length === recordKeys.length &&
      literalKeys.every(
        (key) =>
          key in recordValue &&
          literalEquals(
            (recordValue as Record<string, unknown>)[key],
            (literal as Record<string, unknown>)[key],
          ),
      )
    );
  }
  return false;
}

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
    if (!(key in recordValues)) return undefined;
    const recordValue = recordValues[key];
    if (variable !== undefined) {
      if (!(variable in next)) next = { ...next, [variable]: recordValue };
      else if (next[variable] !== recordValue) return undefined;
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
  next = unifyOutputPattern(record.outcome, pattern.output, next);
  return next === undefined ? undefined : { ...next, [recordBinding]: record.id };
}

function isExcepted(
  clause: ChannelPattern,
  recordConcept: object,
  rawConceptsByInstrumented: WeakMap<object, object>,
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
  rawConceptsByInstrumented: WeakMap<object, object>,
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
