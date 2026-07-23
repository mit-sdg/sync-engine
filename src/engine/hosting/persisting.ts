/**
 * Log storage, retention, and retained-log queries.
 *
 * {@link FileStore} keeps the active indexes in memory and appends every log
 * entry to JSONL. The engine does not load that file on restart.
 * {@link PersistingConcept} keeps a subject registry for application-supplied
 * log stores. Its recorded policy is registry data; the concept delegates
 * pruning to the bound store. It does not install the engine's occurrence-log
 * store. {@link AuditFeed} queries entries retained in a log store's in-memory
 * indexes. Core reaction execution does not depend on this module.
 */

import { appendFileSync } from "node:fs";

import {
  MemoryStore,
  Refuse,
  actionNameOf,
  conceptNameOf,
  type ActionOutcome,
  type ActionRecord,
  type FiringRecord,
  type LogEntry,
  type LogStore,
  type OutcomeContracts,
} from "../reactions/index.ts";
import { redact } from "../utils/redaction.ts";

import type { Stoppable } from "./stoppable.ts";

// ── Retention policies ──────────────────────────────────────────────────────

/**
 * How long a store's in-memory fold retains records. These policies do not
 * rewrite or truncate a {@link FileStore} JSONL file.
 *
 *  - `"keepAll"`     — `prune()` removes no records.
 *  - `"evictConsumed"` — `prune()` removes each flow's contiguous consumed
 *                        suffix.
 *  - `{ window: n }` — retain only the `n` most recently started flows;
 *                      the earliest flows evict as new ones begin.
 */
export type RetentionPolicy = "keepAll" | "evictConsumed" | { window: number };

function assertRetentionPolicy(policy: RetentionPolicy, site: string): void {
  if (typeof policy === "string") return;
  if (!Number.isFinite(policy.window) || !Number.isInteger(policy.window) || policy.window < 0) {
    throw new Error(`${site}: window must be a non-negative finite integer.`);
  }
}

// ── FileStore ───────────────────────────────────────────────────────────────

/**
 * The serialized projection of a {@link LogEntry}, one JSON line per entry.
 * Concept instances and instrumented functions are represented by name. Each
 * input, outcome, fault, and firing-binding mapping passes through redaction,
 * which replaces values whose field names match the current policy. String
 * values under other field names are not inspected.
 */
export type PersistedEntry =
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
  | { kind: "fault"; at: number; id: string; fault: unknown };

function persistedEntryOf(entry: LogEntry): PersistedEntry {
  switch (entry.kind) {
    case "invocation":
      return {
        kind: "invocation",
        at: entry.at,
        id: entry.record.id ?? "",
        flow: entry.record.flow,
        concept: conceptNameOf(entry.record.concept),
        action: actionNameOf(entry.record.action),
        input: redact(entry.record.input),
      };
    case "outcome":
      return { kind: "outcome", at: entry.at, id: entry.id, outcome: redact(entry.outcome) };
    case "firing":
      return {
        kind: "firing",
        at: entry.at,
        firing: { ...entry.firing, bindings: redact(entry.firing.bindings) },
      };
    case "fault":
      return { kind: "fault", at: entry.at, id: entry.id, fault: redact(entry.fault) };
  }
}

/**
 * A {@link LogStore} that folds each entry into memory and appends its
 * serialized projection to a JSONL file. Pruning changes the in-memory indexes
 * and does not rewrite the file.
 */
export class FileStore extends MemoryStore implements Stoppable {
  /** Flow tokens in first-seen order, for the `window` policy. */
  private flowOrder: string[] = [];

  constructor(
    public readonly path: string,
    public readonly policy: RetentionPolicy = "keepAll",
  ) {
    super();
    assertRetentionPolicy(policy, "FileStore");
  }

  override append(entry: LogEntry): void {
    this.assertAppendable(entry);
    const line = `${JSON.stringify(persistedEntryOf(entry))}\n`;
    appendFileSync(this.path, line);
    super.append(entry);
    if (entry.kind === "invocation") this.enforceWindow(entry.record.flow);
  }

  override prune(): number {
    return this.policy === "evictConsumed" ? super.prune() : 0;
  }

  /** File writes are synchronous; this hook lets a host manage the store as a resource. */
  stop(): void {}

  private enforceWindow(flow: string): void {
    if (typeof this.policy === "string") return;
    if (!this.flowOrder.includes(flow)) this.flowOrder.push(flow);
    while (this.flowOrder.length > this.policy.window) {
      const oldest = this.flowOrder.shift();
      if (oldest !== undefined) this.evictFlow(oldest);
    }
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

// ── The Persisting concept ──────────────────────────────────────────────────

/** One registry entry: a subject, its application-supplied store, and recorded policy. */
export interface PersistBinding {
  subject: string;
  store: LogStore;
  policy: RetentionPolicy;
}

/**
 * Keep one application-supplied log-store binding per subject. `bind`,
 * `release`, and `_getBinding` manage or read the registry. `prune` delegates
 * to the bound store; it does not interpret the recorded policy. Registry
 * entries neither bind concept state nor configure an assembly's occurrence
 * log.
 */
export class PersistingConcept {
  // Refusal messages include the subject, so these actions declare no fixed
  // refusal-code list.
  static readonly outcomes: OutcomeContracts = {
    bind: {},
    release: {},
    prune: {},
  };

  /** All current bindings, by subject. */
  bindings: Map<string, PersistBinding> = new Map();

  /** Bind a subject to a store under a policy; refuses if already bound. */
  bind({ subject, store, policy }: { subject: string; store: LogStore; policy: RetentionPolicy }): {
    subject: string;
  } {
    assertRetentionPolicy(policy, "PersistingConcept.bind");
    if (this.bindings.has(subject)) {
      throw new Refuse(`Subject "${subject}" is already bound.`);
    }
    this.bindings.set(subject, { subject, store, policy });
    return { subject };
  }

  /** Release a subject's binding; refuses if none exists. */
  release({ subject }: { subject: string }): { subject: string } {
    if (!this.bindings.has(subject)) {
      throw new Refuse(`Subject "${subject}" is not bound.`);
    }
    this.bindings.delete(subject);
    return { subject };
  }

  /** Delegate pruning to the bound store and return how many records it drops. */
  prune({ subject }: { subject: string }): { evicted: number } {
    const binding = this.bindings.get(subject);
    if (binding === undefined) {
      throw new Refuse(`Subject "${subject}" is not bound.`);
    }
    return { evicted: binding.store.prune() };
  }

  /** Look up a binding. */
  _getBinding({ subject }: { subject: string }): PersistBinding[] {
    const binding = this.bindings.get(subject);
    return binding === undefined ? [] : [binding];
  }
}

// ── The audit feed ──────────────────────────────────────────────────────────

/** One action occurrence read from the retained log. */
export interface AuditEntry {
  id: string;
  concept: string;
  action: string;
  input: Record<string, unknown>;
  outcome?: ActionOutcome;
  flow: string;
  /** Names of the reactions that fired because of this record. */
  firings: string[];
}

/** Does `value` appear anywhere inside `haystack` (strict equality, deep)? */
function containsValue(haystack: unknown, value: unknown, depth = 0): boolean {
  if (haystack === value) return true;
  if (depth > 10 || haystack === null || typeof haystack !== "object") return false;
  const children = Array.isArray(haystack) ? haystack : Object.values(haystack);
  return children.some((child) => containsValue(child, value, depth + 1));
}

/** Query action occurrences and firings retained by a log store. */
export class AuditFeed {
  constructor(private readonly store: LogStore) {}

  /** Every retained occurrence, in no particular order beyond insertion. */
  all(): AuditEntry[] {
    return [...this.store.actions.values()].map((record) => this.entryOf(record));
  }

  /** Occurrences whose input or output mentions the value anywhere. */
  byEntity({ id }: { id: unknown }): AuditEntry[] {
    return this.all().filter(
      (entry) =>
        containsValue(entry.input, id) ||
        (entry.outcome?.kind === "result" && containsValue(entry.outcome.value, id)),
    );
  }

  /** Occurrences of one concept, optionally one action. */
  byConcept({ concept, action }: { concept: string; action?: string }): AuditEntry[] {
    return this.all().filter(
      (entry) => entry.concept === concept && (action === undefined || entry.action === action),
    );
  }

  /** Occurrences within one causal chain, in order. */
  byFlow({ flow }: { flow: string }): AuditEntry[] {
    return (this.store.byFlow(flow) ?? []).map((record) => this.entryOf(record));
  }

  /** All recorded firings of a reaction. */
  firingsOf({ reaction }: { reaction: string }): FiringRecord[] {
    return this.store.firingsByReaction(reaction);
  }

  private entryOf(record: ActionRecord): AuditEntry {
    return {
      id: record.id ?? "",
      concept: conceptNameOf(record.concept),
      action: actionNameOf(record.action),
      input: record.input,
      outcome: record.outcome,
      flow: record.flow,
      firings: this.store.consumedBy(record.id ?? ""),
    };
  }
}
