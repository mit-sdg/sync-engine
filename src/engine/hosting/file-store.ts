/**
 * Node-specific JSONL auditing composed with the runtime occurrence index.
 *
 * {@link FileStore} delegates matching, consumption, and retention to a fresh
 * in-memory index and independently appends every entry to JSONL. The engine
 * does not load or replay that file on restart.
 */

import { appendFileSync } from "node:fs";

import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import {
  MemoryStore,
  type LogEntry,
  type RetentionPolicy,
} from "@engine/reactions/runtime/log-store";
import { createRedactor } from "@engine/utils/redaction";

const fileRedactor = createRedactor();

/**
 * The serialized projection of a {@link LogEntry}, one JSON line per entry.
 * Concept instances and instrumented functions are represented by name. Each
 * input, outcome, fault, and firing-binding mapping passes through redaction,
 * which replaces values whose field names match the current policy. String
 * values under other field names are not inspected.
 */
type AuditEntry =
  | {
      kind: "invocation";
      at: number;
      id: string;
      flow: string;
      concept: string;
      action: string;
      input: unknown;
    }
  | { kind: "outcome"; at: number; id: string; outcome: unknown }
  | { kind: "firing"; at: number; firing: unknown }
  | { kind: "reaction-failure"; at: number; failure: unknown }
  | { kind: "integrity-failure"; at: number; failure: unknown }
  | { kind: "fault"; at: number; id: string; fault: unknown };

function auditEntryOf(entry: LogEntry): AuditEntry {
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

/** Node-specific append-only audit sink. Existing files are never read. */
class JsonlAuditSink {
  constructor(readonly path: string) {}

  append(entry: LogEntry): void {
    const line = `${JSON.stringify(auditEntryOf(entry))}\n`;
    appendFileSync(this.path, line);
  }
}

/**
 * A {@link MemoryStore} with an append-only JSONL audit sink. The inherited
 * store owns matching, consumption, and retention; the sink records every
 * accepted entry before the in-memory fold.
 * Pruning changes only the index; constructing a new store never
 * replays the file.
 */
export class FileStore extends MemoryStore {
  private readonly audit: JsonlAuditSink;

  constructor(
    public readonly path: string,
    policy: RetentionPolicy = "keepAll",
  ) {
    super(policy);
    this.audit = new JsonlAuditSink(path);
  }

  override append(entry: LogEntry): void {
    this.assertAppendable(entry);
    this.audit.append(entry);
    super.append(entry);
  }

  /** Reject entries the in-memory fold would reject before they reach disk. */
  private assertAppendable(entry: LogEntry): void {
    if (entry.kind === "invocation" && entry.record.id === undefined) {
      throw new Error("Invocation entry requires a record id.");
    }
    if ((entry.kind === "outcome" || entry.kind === "fault") && !this.actions.has(entry.id)) {
      throw new Error(`Action with id ${entry.id} not found.`);
    }
  }
}
