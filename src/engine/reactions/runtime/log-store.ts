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
 * A store folds these entries into indexes by id, flow, and reaction. Matching
 * reads those indexes. Each store defines what `prune()` removes.
 */

import type { ActionOutcome, InstrumentedAction } from "../types.ts";

/** How long a store's in-memory fold retains occurrence records. */
export type RetentionPolicy = "keepAll" | "evictConsumed" | { window: number };

export function assertRetentionPolicy(policy: RetentionPolicy, site: string): void {
  if (typeof policy === "string") return;
  if (!Number.isFinite(policy.window) || !Number.isInteger(policy.window) || policy.window < 0) {
    throw new Error(`${site}: window must be a non-negative finite integer.`);
  }
}

/**
 * One entry in the action log, as served by a store's folded view.
 *
 * Consumption is derived from firing entries through
 * {@link LogStore.hasConsumed}; it is not stored on the action record.
 */
export interface ActionRecord {
  id?: string;
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

/** Opaque evidence that a successful endpoint value violated its reviewed runtime contract. */
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
      kind: "execution-limit";
      limit: "actions" | "firings" | "rows";
      errorClass: "ExecutionLimitExceeded";
    }
);

/** An entry appended to the log. Engine-created mappings are field-name redacted. */
export type LogEntry =
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

/**
 * Storage interface for appended entries, retained action indexes, firing
 * indexes, consumption queries, and pruning.
 */
export interface LogStore {
  /** Append one immutable entry, folding it into the indexed views. */
  append(entry: LogEntry): void;
  /** Look up a single action record by id. */
  byId(id: string): ActionRecord | undefined;
  /** All action records belonging to a flow, in order (or `undefined` if unknown). */
  byFlow(flow: string): ActionRecord[] | undefined;
  /** All recorded firings of a reaction, in order. */
  firingsByReaction(reaction: string): FiringRecord[];
  /** Whether a recorded firing of `reaction` has already consumed this record. */
  hasConsumed(recordId: string, reaction: string): boolean;
  /** Names of the reactions whose recorded firings consumed this record. */
  consumedBy(recordId: string): string[];
  /** Apply the store's retention policy and return the number of removed action records. */
  prune(): number;
  /** Observe that the outermost action in a causal flow has settled. */
  flowSettled?(flow: string): void;
  /** Drop all records belonging to a flow from the folded views. */
  evictFlow(flow: string): void;
  /** Folded view: every retained action record, keyed by id. */
  readonly actions: Map<string, ActionRecord>;
  /** Folded view: retained action records grouped by flow token, in invocation order. */
  readonly flowIndex: Map<string, ActionRecord[]>;
}

/**
 * Fold entries into memory and retain them according to the configured policy.
 */
export class MemoryStore implements LogStore {
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
  private activeFlows = new Set<string>();

  constructor(public readonly policy: RetentionPolicy = "evictConsumed") {
    assertRetentionPolicy(policy, "MemoryStore");
  }

  append(entry: LogEntry): void {
    switch (entry.kind) {
      case "invocation": {
        const record = entry.record;
        if (record.id === undefined) {
          throw new Error("Invocation entry requires a record id.");
        }
        this.actions.set(record.id, record);
        const partition = this.flowIndex.get(record.flow) ?? [];
        partition.push(record);
        this.flowIndex.set(record.flow, partition);
        if (typeof this.policy === "object") {
          const settledPosition = this.settledFlowOrder.indexOf(record.flow);
          if (settledPosition >= 0) this.settledFlowOrder.splice(settledPosition, 1);
          this.activeFlows.add(record.flow);
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

  consumedBy(recordId: string): string[] {
    return [...(this.consumedIndex.get(recordId) ?? [])];
  }

  evictFlow(flow: string): void {
    const records = this.flowIndex.get(flow);
    if (records) {
      this.dropFiringsFor(records);
      this.dropRecords(records);
      this.flowIndex.delete(flow);
    }
    this.dropReactionFailures(flow);
    this.dropIntegrityFailures(flow);
    this.activeFlows.delete(flow);
    const position = this.settledFlowOrder.indexOf(flow);
    if (position >= 0) this.settledFlowOrder.splice(position, 1);
  }

  flowSettled(flow: string): void {
    this.activeFlows.delete(flow);
    if (!this.flowIndex.has(flow)) return;
    const previousPosition = this.settledFlowOrder.indexOf(flow);
    if (previousPosition >= 0) this.settledFlowOrder.splice(previousPosition, 1);
    this.settledFlowOrder.push(flow);
    this.enforceWindow();
  }

  /** Apply the configured retention policy and return the removed record count. */
  prune(): number {
    if (this.policy === "keepAll") return 0;
    if (typeof this.policy === "object") return this.enforceWindow();

    let evicted = 0;
    for (const [flow, records] of this.flowIndex) {
      let keepFrom = records.length;
      while (keepFrom > 0 && this.isConsumed(records[keepFrom - 1])) {
        keepFrom--;
      }
      if (keepFrom < records.length) {
        const toRemove = records.splice(keepFrom);
        this.dropFiringsFor(toRemove);
        this.dropRecords(toRemove);
        evicted += toRemove.length;
        if (keepFrom === 0) {
          this.flowIndex.delete(flow);
          this.dropReactionFailures(flow);
        }
      }
    }
    return evicted;
  }

  private enforceWindow(): number {
    if (typeof this.policy === "string") return 0;
    let evicted = 0;
    const candidates = this.settledFlowOrder.slice(
      0,
      Math.max(0, this.settledFlowOrder.length - this.policy.window),
    );
    for (const flow of candidates) {
      if (this.activeFlows.has(flow)) continue;
      evicted += this.flowIndex.get(flow)?.length ?? 0;
      this.evictFlow(flow);
    }
    return evicted;
  }

  private isConsumed(record: ActionRecord | undefined): boolean {
    const id = record?.id;
    return id !== undefined && (this.consumedIndex.get(id)?.size ?? 0) > 0;
  }

  private dropReactionFailures(flow: string): void {
    for (let index = this.reactionFailures.length - 1; index >= 0; index--) {
      if (this.reactionFailures[index]?.flow === flow) this.reactionFailures.splice(index, 1);
    }
  }

  private dropIntegrityFailures(flow: string): void {
    for (let index = this.integrityFailures.length - 1; index >= 0; index--) {
      if (this.integrityFailures[index]?.flow === flow) this.integrityFailures.splice(index, 1);
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
      this.actions.delete(record.id ?? "");
      this.consumedIndex.delete(record.id ?? "");
    }
  }

  /** Remove firings whose consumed occurrences are all evicted and rebuild retained consumption. */
  private dropFiringsFor(records: Iterable<ActionRecord>): void {
    const ids = new Set(
      [...records].flatMap((record) => (record.id === undefined ? [] : [record.id])),
    );
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
