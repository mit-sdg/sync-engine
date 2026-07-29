/**
 * The **action log** — itself a tiny concept.
 *
 * Every instrumented action invocation appends an entry to a {@link LogStore}.
 * Its outcome arrives as a second entry. The store folds both entries into an
 * indexed action record without modifying the invocation entry. Reactions match
 * recorded occurrences rather than live callbacks. The runtime does not load
 * or replay occurrence files.
 *
 * Two indexes are maintained by the store:
 *  - **by id**   — for direct lookup of a record (e.g. when a firing consumes it);
 *  - **by flow** — for restricting matching to a single causal chain. A *flow*
 *    is a token shared by every action in a direct cause/effect chain: an action
 *    triggered from a reaction's `then` inherits the flow of the action that fired
 *    the reaction. Matching only ever considers records within the firing action's
 *    flow, which keeps independent invocations from cross-matching.
 */

import type { ActionOutcome } from "../types.ts";
import { uuid } from "@engine/utils/runtime";
import { redact, serializeError } from "@engine/utils/redaction";
import type { Redactor } from "@engine/utils/redaction";
import { logger } from "@engine/utils/logger";
import { setOwn } from "@engine/utils/own-property";
import {
  MemoryStore,
  type ActionRecord,
  type IntegrityFailureRecord,
  type LogStore,
  type ReactionFailureRecord,
} from "./log-store.ts";
import type { OperationalEvents } from "./operational.ts";

export type { ActionRecord } from "./log-store.ts";

interface MatchingRecordValues {
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  outcome?: ActionOutcome;
}

interface ActiveFlowValues {
  depth: number;
  ids: Set<string>;
  interpreterFailed: boolean;
}

function snapshotMatchValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const prior = seen.get(value);
  if (prior !== undefined) return prior;

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Date.prototype) {
    try {
      const snapshot = new Date(Date.prototype.getTime.call(value));
      seen.set(value, snapshot);
      return snapshot;
    } catch {
      return value;
    }
  }
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  const snapshot: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value)
    ? []
    : Object.create(prototype);
  if (Array.isArray(snapshot)) snapshot.length = (value as unknown[]).length;
  seen.set(value, snapshot);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) continue;
    try {
      const entry = "value" in descriptor ? descriptor.value : Reflect.get(value, key, value);
      setOwn(snapshot, key, snapshotMatchValue(entry, seen));
    } catch (error) {
      Object.defineProperty(snapshot, key, {
        get() {
          throw error;
        },
        enumerable: true,
        configurable: true,
      });
    }
  }
  return snapshot;
}

export interface FlowQuiescence {
  flow: string;
  interpreterFailed: boolean;
}

/**
 * Normalise a raw action output into a first-class {@link ActionOutcome}.
 *
 * A returned mapping is always a result, including one with an `error`
 * property. Invocation records a refusal only when the action throws `Refuse`;
 * other thrown values are faults.
 */
export function normalizeOutcome(output: unknown): ActionOutcome {
  if (typeof output !== "object" || output === null) {
    return { kind: "result", value: {} };
  }
  return { kind: "result", value: output as Record<string, unknown> };
}

/**
 * Appends invocation, outcome, and fault entries and queries the store's
 * retained action records by id or flow.
 */
export class ActionConcept {
  private readonly matchingValues = new Map<string, MatchingRecordValues>();
  private readonly activeFlowValues = new Map<string, ActiveFlowValues>();
  private readonly flowQuiescenceListeners = new Set<(event: FlowQuiescence) => void>();

  constructor(
    public readonly store: LogStore = new MemoryStore(),
    readonly operational?: OperationalEvents,
    readonly redactor: Redactor = { redact },
  ) {}

  /** Folded view: all retained records, keyed by their unique id. */
  get actions(): Map<string, ActionRecord> {
    return this.store.actions;
  }

  /** Folded view: retained records grouped by flow token, in invocation order. */
  get flowIndex(): Map<string, ActionRecord[]> {
    return this.store.flowIndex;
  }

  /**
   * Append an invocation. Input values whose field names match the current
   * redaction policy are replaced before the record reaches the store.
   */
  invoke(record: ActionRecord): { id: string } {
    const id = record.id ?? uuid();
    this.store.append({
      kind: "invocation",
      at: Date.now(),
      record: {
        ...record,
        id,
        input: this.redactor.redact(record.input) as Record<string, unknown>,
      },
    });
    return { id };
  }

  /** Snapshot and retain raw input; raw output and outcome are added when the action resolves. */
  _beginMatchingInput({
    id,
    flow,
    input,
  }: {
    id: string;
    flow: string;
    input: Record<string, unknown>;
  }): Record<string, unknown> {
    const snapshot = snapshotMatchValue(input, new WeakMap()) as Record<string, unknown>;
    const active = this.activeFlowValues.get(flow) ?? {
      depth: 0,
      ids: new Set<string>(),
      interpreterFailed: false,
    };
    active.depth++;
    active.ids.add(id);
    this.activeFlowValues.set(flow, active);
    this.matchingValues.set(id, { input: snapshot });
    return snapshot;
  }

  /** Clear transient values and report quiescence when a flow's outermost call settles. */
  _endMatchingInput(flow: string): void {
    const active = this.activeFlowValues.get(flow);
    if (active === undefined) return;
    active.depth--;
    if (active.depth > 0) return;
    for (const id of active.ids) this.matchingValues.delete(id);
    this.activeFlowValues.delete(flow);
    const event = { flow, interpreterFailed: active.interpreterFailed };
    const listeners = Array.from(this.flowQuiescenceListeners);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error("Flow quiescence listener failed", {
          flow,
          error: serializeError(error),
        });
      }
    }
    this.store.flowSettled?.(flow);
  }

  /** Observe fully settled causal flows before occurrence retention is applied. */
  _onFlowQuiescent(listener: (event: FlowQuiescence) => void): () => void {
    this.flowQuiescenceListeners.add(listener);
    return () => this.flowQuiescenceListeners.delete(listener);
  }

  /** Record durable interpreter evidence and mark its active flow as failed. */
  _recordReactionFailure(failure: ReactionFailureRecord): void {
    const active = this.activeFlowValues.get(failure.flow);
    if (active !== undefined) active.interpreterFailed = true;
    this.store.append({ kind: "reaction-failure", at: failure.at, failure });
    this.operational?.emit(
      this.operational.withContext(failure.flow, {
        type: "interpreter-failed",
        at: failure.at,
        flow: failure.flow,
        reaction: failure.reaction,
        stage: failure.stage,
        ...(failure.action === undefined ? {} : { action: failure.action }),
        ...(failure.actionId === undefined ? {} : { actionId: failure.actionId }),
        errorClass: failure.errorClass,
      }),
    );
  }

  /** Construct and record an accepted execution-limit breach. */
  _recordExecutionLimit(
    flow: string,
    limit: Extract<IntegrityFailureRecord, { kind: "execution-limit" }>["limit"],
  ): void {
    this._recordIntegrityFailure({
      kind: "execution-limit",
      flow,
      limit,
      errorClass: "ExecutionLimitExceeded",
      at: Date.now(),
    });
  }

  /** Record a boundary integrity failure and make the active flow fail closed. */
  _recordIntegrityFailure(failure: IntegrityFailureRecord): void {
    const active = this.activeFlowValues.get(failure.flow);
    if (active !== undefined) active.interpreterFailed = true;
    this.store.append({ kind: "integrity-failure", at: failure.at, failure });
    this.operational?.emit(
      this.operational.withContext(failure.flow, {
        type: "integrity-failed",
        at: failure.at,
        flow: failure.flow,
        kind: failure.kind,
        errorClass: failure.errorClass,
      }),
    );
    if (failure.kind === "execution-limit") {
      this.operational?.emit(
        this.operational.withContext(failure.flow, {
          type: "execution-limit-breached",
          at: failure.at,
          flow: failure.flow,
          limit: failure.limit,
          accepted: true,
        }),
      );
    }
  }

  /** Return a transient record with raw input, output, and outcome while its flow is active. */
  _matchingRecord(record: ActionRecord): ActionRecord {
    const values = record.id === undefined ? undefined : this.matchingValues.get(record.id);
    return values === undefined ? record : { ...record, ...values };
  }

  /** Number of action records with raw input, output, or outcome retained for active flows. */
  _getMatchingRecordCount(): number {
    return this.matchingValues.size;
  }

  /**
   * Append an action output after redacting matching field names. A supplied
   * `outcome` records its known posture; otherwise the output is recorded as a
   * successful result. Raw output and outcome remain available to active-flow
   * matching.
   */
  invoked({
    id,
    output,
    outcome,
  }: {
    id: string;
    output: Record<string, unknown>;
    outcome?: ActionOutcome;
  }): {
    id: string;
  } {
    const resolvedOutcome = outcome ?? normalizeOutcome(output);
    const matching = this.matchingValues.get(id);
    if (matching !== undefined) {
      matching.output = output;
      matching.outcome = resolvedOutcome;
    }
    this.store.append({
      kind: "outcome",
      at: Date.now(),
      id,
      output: this.redactor.redact(output) as Record<string, unknown>,
      outcome: this.redactor.redact(resolvedOutcome) as ActionOutcome,
    });
    return { id };
  }

  /**
   * Append a fault classification for an ask without recording an outcome.
   */
  faulted({ id, fault }: { id: string; fault: Record<string, unknown> }): { id: string } {
    this.store.append({ kind: "fault", at: Date.now(), id, fault });
    return { id };
  }

  /** All records belonging to a flow, in order (or `undefined` if unknown). */
  _getByFlow(flow: string): ActionRecord[] | undefined {
    return this.store.byFlow(flow);
  }

  /** Records without an outcome, including in-flight and faulted asks. */
  _getPending(): ActionRecord[] {
    return [...this.store.actions.values()].filter((record) => record.outcome === undefined);
  }

  /** Records with a fault classification. */
  _getFaulted(): ActionRecord[] {
    return [...this.store.actions.values()].filter((record) => record.fault !== undefined);
  }

  /** Look up a single record by id. */
  _getById(id: string): ActionRecord | undefined {
    return this.store.byId(id);
  }

  /** Evict all records belonging to a flow from the folded views. */
  evictFlow(flow: string): void {
    this.store.evictFlow(flow);
  }

  /** Run the store's prune policy and return its reported eviction count. */
  evictConsumedFlows(): number {
    return this.store.prune();
  }
}
