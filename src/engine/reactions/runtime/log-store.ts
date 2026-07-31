/**
 * Store action and reaction log entries:
 *
 *  - an **invocation** entry, the moment an action begins;
 *  - an **outcome** entry, appended once the action resolves — nothing already
 *    written is ever modified;
 *  - a **firing** entry, recording which reaction fired, with which
 *    bindings, consuming which records and producing which.
 *  - a **reaction failure** entry, recording an interpreter-stage failure;
 *    pre-firing failures consume nothing, while consequence-stage failures may
 *    accompany a firing that already retained its consumption and effects.
 *
 * The runtime folds these entries into an occurrence index by id, flow, and
 * reaction. Matching reads that index.
 */

import type { ActionOutcome, AnyAction, InstrumentedAction } from "../types.ts";
import { actionNameOf, conceptNameOf, CONCEPT_NAME } from "../concepts/introspect.ts";
import { normalizePromiseLike } from "@engine/utils/promise-like";
import { snapshotValue } from "@engine/utils/snapshot";

/** How long an assembly's in-memory occurrence index retains records. */
export type RetentionPolicy = "keepAll" | { window: number };

function assertRetentionPolicy(policy: RetentionPolicy, site: string): void {
  if (policy === "keepAll") return;
  if (typeof policy === "string") {
    throw new Error(`${site}: retention must be "keepAll" or a window policy.`);
  }
  if (!Number.isFinite(policy.window) || !Number.isInteger(policy.window) || policy.window < 0) {
    throw new Error(`${site}: window must be a non-negative finite integer.`);
  }
}

/**
 * One entry in the action log, as served by the engine-owned folded view.
 *
 * Consumption is derived from firing entries in the occurrence index; it is
 * not stored on the action record.
 */
export interface ActionRecord {
  id: string;
  action: InstrumentedAction;
  concept: object;
  input: Record<string, unknown>;
  /**
   * The reaction that made this ask, if any. Every ask is traceable to that
   * reaction or to the application edge. A lowered chain reaction pins its
   * trigger to its own chain's ask through this value.
   */
  by?: string;
  output?: Record<string, unknown>;
  outcome?: ActionOutcome;
  /**
   * Present when a runtime fault interrupted this ask. A faulted ask has no
   * outcome and matches only the `faulted()` posture channel.
   */
  fault?: Record<string, unknown>;
  flow: string;
}

/** A recorded reaction firing: its name, bindings, consumed records, and produced asks. */
export interface FiringRecord {
  id: string;
  /** The reaction name. */
  reaction: string;
  /** The flow whose records this firing consumed. */
  flow: string;
  /** The variable bindings the reaction fired with, keyed by variable name. */
  bindings: Record<string, unknown>;
  /** Ids of the `when` records this firing consumed. */
  consumed: string[];
  /** Ids of the action records this firing produced. */
  produced: string[];
  at: number;
}

/** Opaque evidence of an interpreter failure while evaluating a matched reaction. */
export interface ReactionFailureRecord {
  reaction: string;
  flow: string;
  triggerIds: string[];
  stage:
    | "trigger"
    | "where"
    | "consequence-input"
    | "consequence-dispatch"
    | "consequence-output"
    | "result-transform";
  /** The consequence action being interpreted, for failures after matching. */
  action?: string;
  actionId?: string;
  errorClass: string;
  at: number;
}

/** Opaque evidence that an authored endpoint result violated its reviewed runtime contract. */
export type IntegrityFailureRecord = {
  flow: string;
  at: number;
} & (
  | {
      kind: "invalid-output";
      route: string;
      errorClass: "ValidationFailure" | "ValidatorFault";
    }
  | {
      kind: "invalid-domain-error";
      route: string;
      errorClass: "ValidationFailure" | "ValidatorFault";
    }
  | {
      kind: "execution-limit";
      limit: "actions" | "firings" | "rows";
      errorClass: "ExecutionLimitExceeded";
    }
);

type StoreEntry =
  | { kind: "invocation"; at: number; record: ActionRecord }
  | {
      kind: "outcome";
      at: number;
      id: string;
      output: Record<string, unknown>;
      outcome: ActionOutcome;
    }
  | { kind: "firing"; at: number; firing: FiringRecord }
  | { kind: "reaction-failure"; at: number; failure: ReactionFailureRecord }
  | { kind: "integrity-failure"; at: number; failure: IntegrityFailureRecord }
  /**
   * A fault entry names the interrupted ask and records its validated
   * framework classification. The ask remains without an outcome.
   */
  | { kind: "fault"; at: number; id: string; fault: Record<string, unknown> };

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** A detached action representative. It carries a name but no live engine identity. */
interface LoggedAction {
  readonly name: string;
  readonly action: AnyAction & { readonly name: string };
  (...args: never[]): unknown;
}

/** A detached concept representative. It carries a name but no live engine identity. */
interface LoggedConcept {
  readonly name: string;
}

type LoggedActionRecord = DeepReadonly<Omit<ActionRecord, "action" | "concept">> & {
  readonly action: LoggedAction;
  readonly concept: LoggedConcept;
};

/**
 * A structurally readonly entry handed to a {@link LogSink}. Arrays and plain
 * records are detached and frozen; opaque leaf values retain their normal
 * runtime representation. Engine-created mappings are field-name redacted.
 */
export type LogEntry =
  | { readonly kind: "invocation"; readonly at: number; readonly record: LoggedActionRecord }
  | {
      readonly kind: "outcome";
      readonly at: number;
      readonly id: string;
      readonly output: DeepReadonly<Record<string, unknown>>;
      readonly outcome: DeepReadonly<ActionOutcome>;
    }
  | { readonly kind: "firing"; readonly at: number; readonly firing: DeepReadonly<FiringRecord> }
  | {
      readonly kind: "reaction-failure";
      readonly at: number;
      readonly failure: DeepReadonly<ReactionFailureRecord>;
    }
  | {
      readonly kind: "integrity-failure";
      readonly at: number;
      readonly failure: DeepReadonly<IntegrityFailureRecord>;
    }
  | {
      readonly kind: "fault";
      readonly at: number;
      readonly id: string;
      readonly fault: DeepReadonly<Record<string, unknown>>;
    };

/** A synchronous host-owned destination for already-redacted occurrence entries. */
export interface LogSink {
  /** Accept one immutable entry before it becomes visible to the engine index. */
  append(entry: LogEntry): undefined;
}

function freezeSnapshot(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeSnapshot(child, seen);
  Object.freeze(value);
}

function sinkEntry(entry: StoreEntry): LogEntry {
  const snapshot = snapshotValue(entry) as StoreEntry;
  if (entry.kind === "invocation" && snapshot.kind === "invocation") {
    const actionName = actionNameOf(entry.record.action);
    const rawAction = Object.defineProperty(function () {}, "name", {
      value: actionName,
    });
    const representative = Object.defineProperty(function () {}, "name", {
      value: actionName,
    });
    const action = Object.assign(representative, { action: Object.freeze(rawAction) });
    snapshot.record.action = Object.freeze(action);
    const conceptName = conceptNameOf(entry.record.concept);
    snapshot.record.concept = Object.freeze({
      name: conceptName,
      [CONCEPT_NAME]: conceptName,
    });
  }
  freezeSnapshot(snapshot);
  return snapshot as unknown as LogEntry;
}

/** The core in-memory occurrence index. */
export class MemoryStore {
  readonly actions: Map<string, ActionRecord> = new Map();
  readonly flowIndex: Map<string, ActionRecord[]> = new Map();
  /** Recorded firings, grouped by reaction name, in firing order. */
  readonly firings: Map<string, FiringRecord[]> = new Map();
  /** Non-consuming evaluation failures, in occurrence order. */
  readonly reactionFailures: ReactionFailureRecord[] = [];
  /** Boundary integrity failures, in occurrence order. */
  readonly integrityFailures: IntegrityFailureRecord[] = [];
  /** Derived index folded from firing entries: record id → reactions that consumed it. */
  private consumedIndex: Map<string, Set<string>> = new Map();
  private settledFlowOrder: string[] = [];

  constructor(
    public readonly policy: RetentionPolicy = "keepAll",
    private readonly sink?: LogSink,
  ) {
    assertRetentionPolicy(policy, "MemoryStore");
  }

  append(entry: StoreEntry): void {
    this.assertAppendable(entry);
    if (this.sink !== undefined) {
      const returned: unknown = this.sink.append(sinkEntry(entry));
      if (returned !== undefined) {
        const pending = normalizePromiseLike(returned);
        if (pending !== undefined) void pending.catch(() => undefined);
        throw new TypeError("LogSink.append must return undefined synchronously.");
      }
    }
    this.fold(entry);
  }

  private assertAppendable(entry: StoreEntry): void {
    if ((entry.kind === "outcome" || entry.kind === "fault") && !this.actions.has(entry.id)) {
      throw new Error(`Action with id ${entry.id} not found.`);
    }
  }

  private fold(entry: StoreEntry): void {
    switch (entry.kind) {
      case "invocation": {
        const record = entry.record;
        this.actions.set(record.id, record);
        const partition = this.flowIndex.get(record.flow) ?? [];
        partition.push(record);
        this.flowIndex.set(record.flow, partition);
        if (typeof this.policy === "object") {
          const settledPosition = this.settledFlowOrder.indexOf(record.flow);
          if (settledPosition >= 0) this.settledFlowOrder.splice(settledPosition, 1);
        }
        return;
      }
      case "outcome": {
        this.replaceRecord(entry.id, { output: entry.output, outcome: entry.outcome });
        return;
      }
      case "fault": {
        // Like an outcome, but the ask stays unanswered — only `fault` is set.
        this.replaceRecord(entry.id, { fault: entry.fault });
        return;
      }
      case "firing": {
        const byReaction = this.firings.get(entry.firing.reaction) ?? [];
        byReaction.push(entry.firing);
        this.firings.set(entry.firing.reaction, byReaction);
        for (const recordId of entry.firing.consumed) {
          const consumers = this.consumedIndex.get(recordId) ?? new Set();
          consumers.add(entry.firing.reaction);
          this.consumedIndex.set(recordId, consumers);
        }
        return;
      }
      case "reaction-failure":
        this.reactionFailures.push(entry.failure);
        return;
      case "integrity-failure":
        this.integrityFailures.push(entry.failure);
        return;
    }
  }

  byId(id: string): ActionRecord | undefined {
    return this.actions.get(id);
  }

  byFlow(flow: string): ActionRecord[] | undefined {
    return this.flowIndex.get(flow);
  }

  firingsByReaction(reaction: string): FiringRecord[] {
    return this.firings.get(reaction) ?? [];
  }

  hasConsumed(recordId: string, reaction: string): boolean {
    return this.consumedIndex.get(recordId)?.has(reaction) ?? false;
  }

  private evictFlow(flow: string): void {
    const records = this.flowIndex.get(flow);
    if (records) {
      this.dropFiringsFor(records);
      this.dropRecords(records);
      this.flowIndex.delete(flow);
    }
    this.dropFlowEntries(this.reactionFailures, flow);
    this.dropFlowEntries(this.integrityFailures, flow);
    const position = this.settledFlowOrder.indexOf(flow);
    if (position >= 0) this.settledFlowOrder.splice(position, 1);
  }

  flowSettled(flow: string): void {
    if (!this.flowIndex.has(flow)) return;
    const previousPosition = this.settledFlowOrder.indexOf(flow);
    if (previousPosition >= 0) this.settledFlowOrder.splice(previousPosition, 1);
    this.settledFlowOrder.push(flow);
    this.enforceWindow();
  }

  private enforceWindow(): void {
    if (typeof this.policy === "string") return;
    const candidates = this.settledFlowOrder.slice(
      0,
      Math.max(0, this.settledFlowOrder.length - this.policy.window),
    );
    for (const flow of candidates) {
      this.evictFlow(flow);
    }
  }

  private dropFlowEntries(list: Array<{ flow: string }>, flow: string): void {
    for (let index = list.length - 1; index >= 0; index--) {
      if (list[index]?.flow === flow) list.splice(index, 1);
    }
  }

  /**
   * Replace one folded record in the id map and flow array. The previous
   * record object remains unchanged.
   */
  private replaceRecord(id: string, patch: Partial<ActionRecord>): void {
    const previous = this.actions.get(id);
    if (previous === undefined) {
      throw new Error(`Action with id ${id} not found.`);
    }
    const replacement: ActionRecord = { ...previous, ...patch };
    this.actions.set(id, replacement);
    const partition = this.flowIndex.get(previous.flow);
    if (partition !== undefined) {
      const position = partition.indexOf(previous);
      if (position >= 0) partition[position] = replacement;
    }
  }

  /** Drop each record from both the id map and the derived consumed index. */
  private dropRecords(records: Iterable<ActionRecord>): void {
    for (const record of records) {
      this.actions.delete(record.id);
      this.consumedIndex.delete(record.id);
    }
  }

  /** Remove firings whose consumed occurrences are all evicted and rebuild retained consumption. */
  private dropFiringsFor(records: Iterable<ActionRecord>): void {
    const ids = new Set([...records].map((record) => record.id));
    if (ids.size === 0) return;

    for (const [reaction, firings] of this.firings) {
      const retained = firings.filter(
        (firing) =>
          !firing.consumed.some((id) => ids.has(id)) ||
          firing.consumed.some((id) => !ids.has(id) && this.actions.has(id)),
      );
      if (retained.length === 0) this.firings.delete(reaction);
      else if (retained.length !== firings.length) this.firings.set(reaction, retained);
    }

    this.consumedIndex.clear();
    for (const [reaction, firings] of this.firings) {
      for (const firing of firings) {
        for (const id of firing.consumed) {
          if (ids.has(id) || !this.actions.has(id)) continue;
          const consumers = this.consumedIndex.get(id) ?? new Set<string>();
          consumers.add(reaction);
          this.consumedIndex.set(id, consumers);
        }
      }
    }
  }
}
