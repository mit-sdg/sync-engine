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
  type ActionRecord,
  type FiringRecord,
  type IntegrityFailureRecord,
  type LogEntry,
  type LogStore,
  type ReactionFailureRecord,
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
 * A {@link LogStore} with an in-memory occurrence index and append-only JSONL
 * audit sink. Pruning changes only the index; constructing a new store never
 * replays the file.
 */
export class FileStore implements LogStore {
  private readonly index: MemoryStore;
  private readonly audit: JsonlAuditSink;

  constructor(
    public readonly path: string,
    public readonly policy: RetentionPolicy = "keepAll",
  ) {
    this.index = new MemoryStore(policy);
    this.audit = new JsonlAuditSink(path);
  }

  get actions(): Map<string, ActionRecord> {
    return this.index.actions;
  }

  get flowIndex(): Map<string, ActionRecord[]> {
    return this.index.flowIndex;
  }

  get firings(): Map<string, FiringRecord[]> {
    return this.index.firings;
  }

  get reactionFailures(): ReactionFailureRecord[] {
    return this.index.reactionFailures;
  }

  get integrityFailures(): IntegrityFailureRecord[] {
    return this.index.integrityFailures;
  }

  append(entry: LogEntry): void {
    this.assertAppendable(entry);
    this.audit.append(entry);
    this.index.append(entry);
  }

  byId(id: string): ActionRecord | undefined {
    return this.index.byId(id);
  }

  byFlow(flow: string): ActionRecord[] | undefined {
    return this.index.byFlow(flow);
  }

  firingsByReaction(reaction: string): FiringRecord[] {
    return this.index.firingsByReaction(reaction);
  }

  hasConsumed(recordId: string, reaction: string): boolean {
    return this.index.hasConsumed(recordId, reaction);
  }

  consumedBy(recordId: string): string[] {
    return this.index.consumedBy(recordId);
  }

  prune(): number {
    return this.index.prune();
  }

  flowSettled(flow: string): void {
    this.index.flowSettled(flow);
  }

  evictFlow(flow: string): void {
    this.index.evictFlow(flow);
  }

  /** Reject entries the in-memory fold would reject before they reach disk. */
  private assertAppendable(entry: LogEntry): void {
    if (entry.kind === "invocation" && entry.record.id === undefined) {
      throw new Error("Invocation entry requires a record id.");
    }
    if ((entry.kind === "outcome" || entry.kind === "fault") && !this.index.actions.has(entry.id)) {
      throw new Error(`Action with id ${entry.id} not found.`);
    }
  }
}
