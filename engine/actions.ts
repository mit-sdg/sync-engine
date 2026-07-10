/**
 * The **action journal** — itself a tiny concept.
 *
 * Every instrumented action invocation appends an immutable {@link ActionRecord}
 * to an append-only log. Synchronizations are then matched against this log
 * rather than against live program state, which is what makes the engine's
 * reactive semantics declarative and replayable.
 *
 * Two indexes are maintained:
 *  - **by id**   — for direct lookup of a record (e.g. when marking it synced);
 *  - **by flow** — for restricting matching to a single causal chain. A *flow*
 *    is a token shared by every action in a direct cause/effect chain: an action
 *    triggered from a sync's `then` inherits the flow of the action that fired
 *    the sync. Matching only ever considers records within the firing action's
 *    flow, which keeps independent invocations from cross-matching.
 */

import type { ActionOutcome, InstrumentedAction } from "./types.ts";
import { uuid } from "./util.ts";

/**
 * One immutable entry in the action journal.
 *
 * `synced` records, per consuming sync, which produced action a `when` record
 * has already been spent on — the mechanism that prevents a sync from firing
 * twice off the same evidence (see `SyncConcept`'s double-fire prevention).
 */
export interface ActionRecord {
  id?: string;
  action: InstrumentedAction;
  concept: object;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  outcome?: ActionOutcome;
  synced?: Map<string, string>;
  flow: string;
}

/**
 * Normalise a raw action output record into a first-class {@link ActionOutcome}.
 *
 * The engine calls this once per invocation so every downstream site —
 * matching, branching, observer events — works with a discriminated union
 * instead of ad-hoc `"error" in output` checks.
 */
export function normalizeOutcome(output: unknown): ActionOutcome {
  if (typeof output !== "object" || output === null) {
    return { kind: "complete" };
  }
  const obj = output as Record<string, unknown>;
  if ("error" in obj) {
    return { kind: "error", error: obj };
  }
  if (Object.keys(obj).length === 0) {
    return { kind: "complete" };
  }
  return { kind: "result", value: obj };
}

/**
 * Append-only journal of action invocations, indexed by id and by flow.
 *
 * The public surface (`invoke`, `invoked`, `_getByFlow`, `_getById`) mirrors a
 * concept: actions mutate the log, queries (prefixed `_`) read it.
 */
export class ActionConcept {
  /** All records, keyed by their unique id. */
  actions: Map<string, ActionRecord> = new Map();
  /** Records grouped by flow token, in invocation order. */
  flowIndex: Map<string, ActionRecord[]> = new Map();

  /** Append a record (the moment an action begins), returning its id. */
  invoke(record: ActionRecord): { id: string } {
    const id = record.id ?? uuid();
    const actionRecord: ActionRecord = { ...record, id };

    this.actions.set(id, actionRecord);
    const partition = this.flowIndex.get(record.flow) ?? [];
    partition.push(actionRecord);
    this.flowIndex.set(record.flow, partition);

    return { id };
  }

  /** Attach an action's output once it has resolved. */
  invoked({ id, output }: { id: string; output: Record<string, unknown> }): {
    id: string;
  } {
    const action = this.actions.get(id);
    if (action === undefined) {
      throw new Error(`Action with id ${id} not found.`);
    }
    action.output = output;
    action.outcome = normalizeOutcome(output);
    return { id };
  }

  /** All records belonging to a flow, in order (or `undefined` if unknown). */
  _getByFlow(flow: string): ActionRecord[] | undefined {
    return this.flowIndex.get(flow);
  }

  /** Look up a single record by id. */
  _getById(id: string): ActionRecord | undefined {
    return this.actions.get(id);
  }

  /** Evict all records belonging to a flow from both indexes. */
  evictFlow(flow: string): void {
    const records = this.flowIndex.get(flow);
    if (records) {
      for (const record of records) {
        this.actions.delete(record.id ?? "");
      }
      this.flowIndex.delete(flow);
    }
  }

  /** Evict all flows whose last action has been synced. */
  evictSyncedFlows(): number {
    let evicted = 0;
    const toEvict: string[] = [];
    for (const [flow, records] of this.flowIndex) {
      const lastRecord = records[records.length - 1];
      if (lastRecord?.synced && lastRecord.synced.size > 0) {
        toEvict.push(flow);
      }
    }
    for (const flow of toEvict) {
      this.evictFlow(flow);
      evicted++;
    }
    return evicted;
  }
}
