/**
 * Store action and reaction log entries:
 *
 *  - an **invocation** entry, the moment an action begins;
 *  - an **outcome** entry, appended once the action resolves — nothing already
 *    written is ever modified;
 *  - a **firing** entry, recording which reaction fired, with which
 *    bindings, consuming which records and producing which.
 *
 * A store folds these entries into indexes by id, flow, and reaction. Matching
 * reads those indexes. Each store defines what `prune()` removes.
 */

import type { ActionOutcome, InstrumentedAction } from "./types.ts";

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
  /** Drop all records belonging to a flow from the folded views. */
  evictFlow(flow: string): void;
  /** Folded view: every retained action record, keyed by id. */
  readonly actions: Map<string, ActionRecord>;
  /** Folded view: retained action records grouped by flow token, in invocation order. */
  readonly flowIndex: Map<string, ActionRecord[]>;
}

/**
 * The default store folds entries into memory. For each flow, `prune()`
 * removes the contiguous records at the end that at least one recorded firing
 * has consumed. It stops at the first unconsumed record.
 */
export class MemoryStore implements LogStore {
  readonly actions: Map<string, ActionRecord> = new Map();
  readonly flowIndex: Map<string, ActionRecord[]> = new Map();
  /** Recorded firings, grouped by reaction name, in firing order. */
  readonly firings: Map<string, FiringRecord[]> = new Map();
  /** Derived index folded from firing entries: record id → reactions that consumed it. */
  private consumedIndex: Map<string, Set<string>> = new Map();

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
  }

  /** Remove each flow's contiguous consumed suffix and return the record count. */
  prune(): number {
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
        }
      }
    }
    return evicted;
  }

  private isConsumed(record: ActionRecord | undefined): boolean {
    const id = record?.id;
    return id !== undefined && (this.consumedIndex.get(id)?.size ?? 0) > 0;
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

  /** Remove firings that refer to evicted occurrences and rebuild consumption from what remains. */
  private dropFiringsFor(records: Iterable<ActionRecord>): void {
    const ids = new Set(
      [...records].flatMap((record) => (record.id === undefined ? [] : [record.id])),
    );
    if (ids.size === 0) return;

    for (const [reaction, firings] of this.firings) {
      const retained = firings.filter((firing) => !firing.consumed.some((id) => ids.has(id)));
      if (retained.length === 0) this.firings.delete(reaction);
      else if (retained.length !== firings.length) this.firings.set(reaction, retained);
    }

    this.consumedIndex.clear();
    for (const [reaction, firings] of this.firings) {
      for (const firing of firings) {
        for (const id of firing.consumed) {
          const consumers = this.consumedIndex.get(id) ?? new Set<string>();
          consumers.add(reaction);
          this.consumedIndex.set(id, consumers);
        }
      }
    }
  }
}
