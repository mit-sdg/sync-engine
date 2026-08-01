/**
 * Node-specific JSONL occurrence auditing.
 *
 * {@link FileLogSink} appends every accepted entry to JSONL. The engine owns
 * matching, consumption, and retention and does not load or replay this file.
 */

import { appendFileSync } from "node:fs";

import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import type { LogEntry, LogSink } from "@engine/reactions/runtime/log-store";
import { createRedactor } from "@engine/utils/redaction";

const fileRedactor = createRedactor();

/**
 * The serialized projection of a {@link LogEntry}, one JSON line per entry.
 * Concept instances and instrumented functions are represented by name. Each
 * input, outcome, fault, and firing-binding mapping passes through redaction,
 * which replaces values whose field names match the current policy. String
 * values under other field names are not inspected.
 */
function auditEntryOf(entry: LogEntry) {
  switch (entry.kind) {
    case "invocation":
      return {
        kind: "invocation",
        at: entry.at,
        id: entry.record.id ?? "",
        flow: entry.record.flow,
        concept: conceptNameOf(entry.record.concept),
        action: actionNameOf(entry.record.action),
        input: fileRedactor.redact(entry.record.input),
      };
    case "outcome":
      return {
        kind: "outcome",
        at: entry.at,
        id: entry.id,
        outcome: fileRedactor.redact(entry.outcome),
      };
    case "firing":
      return {
        kind: "firing",
        at: entry.at,
        firing: { ...entry.firing, bindings: fileRedactor.redact(entry.firing.bindings) },
      };
    case "reaction-failure":
      return { kind: "reaction-failure", at: entry.at, failure: entry.failure };
    case "integrity-failure":
      return { kind: "integrity-failure", at: entry.at, failure: entry.failure };
    case "fault":
      return {
        kind: "fault",
        at: entry.at,
        id: entry.id,
        fault: fileRedactor.redact(entry.fault),
      };
  }
}

/**
 * A synchronous append-only JSONL occurrence sink. Existing files are never
 * read or replayed, and retention changes never rewrite them.
 */
export class FileLogSink implements LogSink {
  constructor(public readonly path: string) {}

  append(entry: LogEntry): undefined {
    const line = `${JSON.stringify(auditEntryOf(entry))}\n`;
    appendFileSync(this.path, line);
  }
}
