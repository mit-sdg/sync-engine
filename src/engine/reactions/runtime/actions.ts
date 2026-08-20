/**
 * The **action log** — itself a tiny concept.
 *
 * Every instrumented action invocation appends an occurrence entry.
 * Its outcome arrives as a second entry. The index folds both entries into an
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
import { redact, serializeError } from "@engine/utils/redaction";
import { ListenerSet } from "@engine/utils/listener-set";
import { snapshotValue } from "@engine/utils/snapshot";
import type { Redactor } from "@engine/utils/redaction";
import { logger } from "@engine/utils/logger";
import { actionNameOf, conceptNameOf } from "../concepts/introspect.ts";
import {
  MemoryStore,
  type ActionRecord,
  type IntegrityFailureRecord,
  type ReactionFailureRecord,
} from "./log-store.ts";
import {
  reportRawFault,
  type OperationalEvents,
  type RawFaultReport,
  type RawFaultReporter,
} from "./operational.ts";

export type { ActionRecord } from "./log-store.ts";

interface MatchingRecordValues {
  input: Record<string, unknown>;
  outcome?: ActionOutcome;
}

interface ActiveFlowValues {
  depth: number;
  ids: Set<string>;
  interpreterFailed: boolean;
  /** Milliseconds from the one clock read that opened this causal flow. */
  instant: number;
}

interface FlowQuiescence {
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
  private readonly flowQuiescenceListeners = new ListenerSet<(event: FlowQuiescence) => void>();

  constructor(
    public readonly store: MemoryStore = new MemoryStore(),
    readonly operational?: OperationalEvents,
    readonly redactor: Redactor = { redact },
    private readonly rawFaultReporter?: RawFaultReporter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  _reportRawFault(report: RawFaultReport): void {
    const context = report.flow === undefined ? undefined : this.operational?.context(report.flow);
    reportRawFault(
      this.rawFaultReporter,
      context === undefined ? report : { ...context, ...report },
    );
  }

  /** Folded view: all retained records, keyed by their unique id. */
  get actions(): Map<string, ActionRecord> {
    return this.store.actions;
  }

  /**
   * Append an invocation. Input values whose field names match the current
   * redaction policy are replaced before the record reaches the store.
   */
  invoke(record: ActionRecord): void {
    this.store.append({
      kind: "invocation",
      at: this.activeFlowValues.get(record.flow)?.instant ?? Date.now(),
      record: {
        ...record,
        input: this.redactor.redact(record.input) as Record<string, unknown>,
      },
    });
  }

  /** Snapshot and retain raw input; the raw outcome is added when the action resolves. */
  _beginMatchingInput({
    id,
    flow,
    input,
  }: {
    id: string;
    flow: string;
    input: Record<string, unknown>;
  }): Record<string, unknown> {
    const snapshot = snapshotValue(input) as Record<string, unknown>;
    const active = this.activeFlowValues.get(flow) ?? {
      depth: 0,
      ids: new Set<string>(),
      interpreterFailed: false,
      instant: this.readInstant(),
    };
    active.depth++;
    active.ids.add(id);
    this.activeFlowValues.set(flow, active);
    this.matchingValues.set(id, { input: snapshot });
    return snapshot;
  }

  private readInstant(): number {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError("The assembly clock must return a valid Date.");
    }
    return value.getTime();
  }

  /** Clear transient values and report quiescence when a flow's outermost call settles. */
  _endMatchingInput(flow: string): void {
    const active = this.activeFlowValues.get(flow);
    if (active === undefined) return;
    active.depth--;
    if (active.depth > 0) return;
    for (const id of active.ids) this.matchingValues.delete(id);
    this.activeFlowValues.delete(flow);
    this.flowQuiescenceListeners.notify(
      (listener, event) => listener(event),
      { flow, interpreterFailed: active.interpreterFailed },
      (error) =>
        logger.error("Flow quiescence listener failed", {
          flow,
          error: serializeError(error),
        }),
    );
    this.store.flowSettled(flow);
  }

  /** The DateTime structurally shared by every reaction evaluating this active flow. */
  _flowInstant(flow: string): Date | undefined {
    const instant = this.activeFlowValues.get(flow)?.instant;
    return instant === undefined ? undefined : new Date(instant);
  }

  /** Observe fully settled causal flows before occurrence retention is applied. */
  _onFlowQuiescent(listener: (event: FlowQuiescence) => void): () => void {
    return this.flowQuiescenceListeners.add(listener);
  }

  /**
   * Whether the caller is the flow's only active ask — its settlement
   * frontier. Every ordinary cascade the flow started has drained, and the
   * occurrences, bindings, and transient matching values a deferred trigger
   * matches against are still retained.
   */
  _isFlowOutermost(flow: string): boolean {
    return this.activeFlowValues.get(flow)?.depth === 1;
  }

  /** Whether an interpreter or integrity failure has closed this active flow. */
  _flowFailed(flow: string): boolean {
    return this.activeFlowValues.get(flow)?.interpreterFailed ?? false;
  }

  /** Serialize and record a sanitized failure produced between instrumented action asks. */
  _recordInterpreterFailure(
    reaction: string,
    flow: string,
    triggerIds: string[],
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    consequence: Pick<ReactionFailureRecord, "action" | "actionId"> = {},
  ): void {
    const serialized = serializeError(error);
    this._recordReactionFailure({
      reaction,
      flow,
      triggerIds,
      stage,
      ...consequence,
      errorClass: typeof serialized.name === "string" ? serialized.name : "Error",
      at: Date.now(),
    });
    this._reportRawFault({
      kind: "interpreter",
      error,
      at: Date.now(),
      flow,
      reaction,
      stage,
      ...consequence,
    });
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

  /** Return a transient record with raw input and outcome while its flow is active. */
  _matchingRecord(record: ActionRecord): ActionRecord {
    const values = this.matchingValues.get(record.id);
    return values === undefined ? record : { ...record, ...values };
  }

  /** Number of action records with raw matching values retained for active flows. */
  _getMatchingRecordCount(): number {
    return this.matchingValues.size;
  }

  /**
   * Append an action output after redacting matching field names. A supplied
   * `outcome` records its known posture; otherwise the output is recorded as a
   * successful result. The raw outcome remains available to active-flow matching.
   */
  invoked({
    id,
    output,
    outcome,
  }: {
    id: string;
    output: Record<string, unknown>;
    outcome?: ActionOutcome;
  }): void {
    const resolvedOutcome = outcome ?? normalizeOutcome(output);
    const matching = this.matchingValues.get(id);
    if (matching !== undefined) {
      matching.outcome = resolvedOutcome;
    }
    this.store.append({
      kind: "outcome",
      at: Date.now(),
      id,
      output: this.redactor.redact(output) as Record<string, unknown>,
      outcome: this.redactor.redact(resolvedOutcome) as ActionOutcome,
    });
  }

  /**
   * Append a fault classification for an ask without recording an outcome.
   */
  faulted({
    id,
    fault,
    error,
  }: {
    id: string;
    fault: Record<string, unknown>;
    error?: unknown;
  }): void {
    const record = this.store.byId(id);
    const at = Date.now();
    this.store.append({ kind: "fault", at, id, fault });
    if (error !== undefined && record !== undefined) {
      this._reportRawFault({
        kind: "action",
        error,
        at,
        flow: record.flow,
        concept: conceptNameOf(record.concept),
        action: actionNameOf(record.action),
        actionId: id,
        ...(record.by === undefined ? {} : { reaction: record.by }),
      });
    }
  }

  /** All records belonging to a flow, in order (or `undefined` if unknown). */
  _getByFlow(flow: string): ActionRecord[] | undefined {
    return this.store.byFlow(flow);
  }

  /** Look up a single record by id. */
  _getById(id: string): ActionRecord | undefined {
    return this.store.byId(id);
  }
}

/** Record an accepted execution-limit breach and return its caller-facing error. */
export function breachLimit(
  actions: Pick<ActionConcept, "_recordExecutionLimit">,
  flow: string,
  limit: "actions" | "firings" | "rows",
): Error {
  actions._recordExecutionLimit(flow, limit);
  return new Error(
    limit === "rows"
      ? "The evaluation exceeded its row limit."
      : limit === "actions"
        ? "The flow exceeded its action limit."
        : "The flow exceeded its firing limit.",
  );
}
