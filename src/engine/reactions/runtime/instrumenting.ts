import { FrameworkErrorCode } from "@engine/utils/framework-error-codes";
import { inspect, inspectCustom, uuid } from "@engine/utils/runtime";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { ActionConcept, breachLimit } from "./actions.ts";
import type { ActionRecord } from "./actions.ts";
import { refusalFor } from "../concepts/concept-metadata.ts";
import { CONCEPT_NAME, conceptNameOf } from "../concepts/introspect.ts";
import { contractOf } from "../concepts/outcomes.ts";
import type { ActionContract } from "../concepts/outcomes.ts";
import { isRefuse, refusalMapping } from "../concepts/refuse.ts";
import { actionId, actionSettlement, byReaction, flow } from "../context.ts";
import type { ActionSettlement } from "../context.ts";
import type { ActionOutcome, AnyAction, InstrumentedAction } from "../types.ts";
import { queryPromiseOf, validateQueryContracts } from "@engine/reads/query-contracts";
import { registerEvaluationQuery } from "@engine/reads/queries";
import type { ActionScheduling } from "./action-scheduler.ts";
import type { ExecutionControl } from "./operational.ts";
import { memoizeQuery } from "@engine/utils/memoize";

type ActionArguments = Record<string | symbol, unknown>;

export type QueryCacheMode = "memoize" | "none";

function uncachedQuery<T extends (...args: never[]) => unknown>(
  query: T,
): T & {
  invalidate(): void;
} {
  return Object.assign(query, { invalidate() {} });
}

/** A deliberate refusal returned to the direct caller of an instrumented action. */
export type ActionRefusal = Readonly<Record<string, unknown>> & {
  readonly error: string;
};

/**
 * The runtime surface of an instrumented concept.
 *
 * Concept classes stay ordinary: an action may return synchronously and may
 * throw its declared refusal. Once instrumented, every action is asynchronous
 * because the engine records and reacts to its occurrence before settling the
 * caller. A deliberate refusal resolves to its refusal mapping; ordinary
 * faults reject. Queries are asynchronous roots so admission, limits, drain,
 * and idle observation include their complete evaluation.
 */
export type InstrumentedConcept<T extends object> = {
  [Key in keyof T]: T[Key] extends (...args: infer Args) => infer Result
    ? Key extends `_${string}`
      ? (...args: Args) => Promise<Awaited<Result>>
      : (...args: Args) => Promise<Awaited<Result> | ActionRefusal>
    : T[Key];
};

export interface InstrumentationState {
  actions: ActionConcept;
  boundActionsByConcept: WeakMap<object, Map<AnyAction, InstrumentedAction>>;
  queryCaches: WeakMap<object, Array<{ invalidate: () => void }>>;
  scheduler: ActionScheduling;
  rawConceptsByInstrumented: WeakMap<object, object>;
  concepts: Set<WeakRef<object>>;
  requireDeclaredRefusals?: boolean;
  queryCache?: QueryCacheMode;
  registerConcept(name: string, instrumented: object): void;
  execution?: Pick<ExecutionControl, "action" | "rows" | "admitFlow" | "abandon" | "flowSettled">;
  react(record: ActionRecord, durationMs?: number): Promise<void>;
  /** Run the flow's settlement frontiers when this ask is its outermost one. */
  settle(flow: string): void | Promise<void>;
  emit(record: ActionRecord, durationMs?: number): void;
}

/**
 * Run the reaction round that follows a durable landing. A failure there is
 * logged and observed but can never take ownership of the caller's settled
 * outcome, so it is swallowed after the evidence exists.
 */
export async function reactQuietly(
  state: Pick<InstrumentationState, "react" | "emit">,
  record: ActionRecord,
  durationMs: number | undefined,
  landing: string,
  context: Record<string, unknown> = {},
  emitOnFailure = false,
): Promise<void> {
  try {
    await state.react(record, durationMs);
  } catch (error) {
    logger.error(`Reaction body failed after the ${landing} was recorded`, {
      ...context,
      error: serializeError(error),
    });
    if (emitOnFailure) state.emit(record, durationMs);
  }
}

const frameworkErrorCodes = new Set<string>(Object.values(FrameworkErrorCode));

function receivedKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Classify a thrown value without copying its diagnostic fields. */
export function errorOutputFromThrown(error: unknown): Record<string, unknown> {
  if (error !== null && typeof error === "object") {
    const thrown = error as Record<string, unknown>;
    const read = (key: "error" | "code"): unknown => {
      try {
        return thrown[key];
      } catch {
        return undefined;
      }
    };
    for (const candidate of [read("error"), read("code")]) {
      if (typeof candidate === "string" && frameworkErrorCodes.has(candidate)) {
        return { error: candidate };
      }
    }
  }
  return { error: FrameworkErrorCode.UNKNOWN_ERROR };
}

const undeclaredRefusalWarned = new Set<string>();

function warnUndeclaredRefusal(
  name: string,
  contract: ActionContract | undefined,
  code: string,
): void {
  if (contract?.refusals === undefined || contract.refusals.includes(code)) return;
  const key = `${name}:${code}`;
  if (undeclaredRefusalWarned.has(key)) return;
  undeclaredRefusalWarned.add(key);
  logger.warn(
    `${name} refused with undeclared code "${code}" — declared refusals: [${contract.refusals.join(", ")}].`,
  );
}

/** Build the stable action/query proxy for one concept instance. */
export function instrumentConcept<T extends object>(
  state: InstrumentationState,
  concept: T,
  name?: string,
): T {
  validateQueryContracts(concept, name ?? conceptNameOf(concept));
  if (name !== undefined && conceptNameOf(concept) !== name) {
    Object.defineProperty(concept, CONCEPT_NAME, { value: name, configurable: true });
  }
  state.concepts.add(new WeakRef(concept));
  let boundActions = state.boundActionsByConcept.get(concept);
  if (boundActions === undefined) {
    boundActions = new Map();
    state.boundActionsByConcept.set(concept, boundActions);
  }

  const instrumentedConcept = new Proxy(concept, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const actionKey = value as AnyAction;

      if (String(property).startsWith("_")) {
        const memoized = boundActions.get(actionKey);
        if (memoized !== undefined) return memoized;
        const query = value.bind(concept);
        const withCache = state.queryCache === "none" ? uncachedQuery(query) : memoizeQuery(query);
        const displayName = `${conceptNameOf(concept)}.${String(property)}`;
        const directQuery =
          state.execution?.admitFlow === undefined
            ? withCache
            : async (...args: Parameters<typeof withCache>) => {
                const flowToken = uuid();
                if (state.execution?.admitFlow?.(flowToken, displayName, flowToken) !== undefined) {
                  throw new Error(`Read "${displayName}" is unavailable.`);
                }
                withCache.invalidate();
                try {
                  const result = await withCache(...args);
                  const count = Array.isArray(result) ? result.length : 1;
                  if (state.execution?.rows(count) === false) {
                    throw breachLimit(state.actions, flowToken, "rows");
                  }
                  return result;
                } finally {
                  state.execution?.flowSettled?.(flowToken);
                }
              };
        const instrumentedQuery = directQuery as typeof directQuery & {
          concept?: object;
          queryName?: string;
          queryLabel?: string;
          queryPromise?: import("@engine/reads/query-contracts").QueryPromise;
        };
        instrumentedQuery.concept = concept;
        instrumentedQuery.queryName = String(property);
        instrumentedQuery.queryLabel = displayName;
        instrumentedQuery.queryPromise = queryPromiseOf(concept, String(property));
        registerEvaluationQuery(
          instrumentedQuery as import("../types.ts").InstrumentedQuery,
          withCache as import("../types.ts").InstrumentedQuery,
        );
        boundActions.set(actionKey, instrumentedQuery as unknown as InstrumentedAction);
        const caches = state.queryCaches.get(concept) ?? [];
        if (!state.queryCaches.has(concept)) state.queryCaches.set(concept, caches);
        caches.push(withCache);
        return instrumentedQuery;
      }

      let instrumented = boundActions.get(actionKey);
      if (instrumented !== undefined) return instrumented;
      const action = value.bind(concept);
      const actionName = String(property);
      const displayName = `${conceptNameOf(concept)}.${actionName}`;
      const contract = contractOf(concept, actionName);

      instrumented = async function instrumented(args: ActionArguments) {
        const invalidate = () => {
          state.queryCaches.get(concept)?.forEach((cache) => cache.invalidate());
        };
        let {
          [flow]: flowToken,
          [actionId]: id,
          [byReaction]: askedBy,
          [actionSettlement]: reportSettlement,
          ...input
        } = args;
        const report =
          typeof reportSettlement === "function"
            ? (reportSettlement as (settlement: ActionSettlement) => void)
            : undefined;
        const directRoot = flowToken === undefined;
        if (flowToken === undefined) flowToken = uuid();
        if (typeof flowToken !== "string") {
          throw new Error(
            `Action "${displayName}": expected the flow token to be a string; received ${receivedKind(flowToken)}.`,
          );
        }
        if (id === undefined) id = uuid();
        if (typeof id !== "string") {
          throw new Error(
            `Action "${displayName}": expected actionId to be a string; received ${receivedKind(id)}.`,
          );
        }
        if (
          directRoot &&
          state.execution?.admitFlow?.(flowToken, displayName, flowToken) !== undefined
        ) {
          return { error: FrameworkErrorCode.UNAVAILABLE };
        }
        if (state.execution?.action(flowToken) === false) {
          let breach: Error;
          try {
            breach = breachLimit(state.actions, flowToken, "actions");
          } finally {
            if (directRoot) state.execution?.abandon?.(flowToken);
          }
          throw breach;
        }
        invalidate();

        const matchingInput = state.actions._beginMatchingInput({ id, flow: flowToken, input });
        const record: ActionRecord = {
          id,
          action: instrumented as InstrumentedAction,
          concept,
          input: matchingInput,
          flow: flowToken,
          ...(typeof askedBy === "string" ? { by: askedBy } : {}),
        };
        try {
          state.actions.invoke(record);
          report?.("ask-recorded");

          const reservation = state.scheduler.reserve({
            concept,
            flow: flowToken,
            body: action,
            input,
            onBodySettled: invalidate,
          });

          await reactQuietly(state, { ...record }, undefined, "action ask", {
            actionId: id,
            concept: concept.constructor.name,
            action: action.name,
          });
          reservation.release();

          let output: Record<string, unknown>;
          let outcome: ActionOutcome | undefined;
          try {
            output = (await reservation.result) as Record<string, unknown>;
            if (contract !== undefined) {
              outcome = {
                kind: "result",
                value: output !== null && typeof output === "object" ? output : {},
              };
            }
          } catch (error) {
            const declaredRefuse =
              isRefuse(error) && contract?.refusals?.includes(error.message) === true;
            if (isRefuse(error) && (!state.requireDeclaredRefusals || declaredRefuse)) {
              output = refusalMapping(error);
              outcome = { kind: "error", error: output };
              warnUndeclaredRefusal(displayName, contract, error.message);
            } else {
              const refusal = isRefuse(error) ? undefined : refusalFor(concept, actionName, error);
              if (refusal?.kind === "misplaced") {
                logger.error(
                  `${displayName} signalled the refusal "${refusal.code}", which its specification ` +
                    `declares only on ${refusal.declaredOn.join(", ")} — give this action the branch ` +
                    `or stop signalling it here.`,
                );
              }
              if (refusal?.kind === "declared") {
                // The specification's sentence is the normative one, so the
                // class need not carry the message the caller receives.
                output = { error: refusal.code, detail: refusal.message };
                outcome = { kind: "error", error: output };
                warnUndeclaredRefusal(displayName, contract, refusal.code);
              } else {
                const durationMs = reservation.durationMs();
                state.actions.faulted({ id, fault: errorOutputFromThrown(error), error });
                report?.("fault-recorded");
                await reactQuietly(
                  state,
                  { ...record },
                  durationMs,
                  "action fault",
                  {
                    actionId: id,
                    concept: concept.constructor.name,
                    action: action.name,
                  },
                  true,
                );
                throw error;
              }
            }
          }
          const durationMs = reservation.durationMs();
          state.actions.invoked({ id, output, outcome });
          await reactQuietly(
            state,
            { ...record, output },
            durationMs,
            "action outcome",
            {
              actionId: id,
              concept: concept.constructor.name,
              action: action.name,
            },
            true,
          );
          return output;
        } finally {
          // The flow's outermost ask reaches its settlement frontier here:
          // its cascades have drained, and the occurrences and matching
          // values a deferred trigger reads are still retained below.
          try {
            const settling = state.settle(flowToken);
            if (settling !== undefined) await settling;
          } finally {
            state.actions._endMatchingInput(flowToken);
          }
        }
      } as InstrumentedAction;

      instrumented.concept = concept;
      instrumented.action = action;
      const representation = () => inspect(action);
      instrumented.toString = representation;
      Object.defineProperty(instrumented, inspectCustom, {
        value: representation,
        writable: false,
        configurable: true,
      });
      boundActions.set(actionKey, instrumented);
      return instrumented;
    },
  });

  state.rawConceptsByInstrumented.set(instrumentedConcept, concept);
  state.registerConcept(conceptNameOf(concept), instrumentedConcept);
  return instrumentedConcept;
}

function instrument<T extends Record<string, object>>(state: InstrumentationState, concepts: T): T;
function instrument<T extends object>(state: InstrumentationState, concept: T): T;
function instrument(
  state: InstrumentationState,
  concepts: Record<string, object> | object,
): Record<string, object> | object {
  if (concepts !== null && typeof concepts === "object" && concepts.constructor === Object) {
    const entries = Object.entries(concepts);
    if (
      entries.length > 0 &&
      entries.every(([, value]) => typeof value === "object" && value !== null)
    ) {
      return Object.fromEntries(
        entries.map(([key, concept]) => [key, instrumentConcept(state, concept)]),
      );
    }
  }
  return instrumentConcept(state, concepts);
}

/** Owns the mutable proxy identities and query caches for one engine. */
export class ConceptInstrumentation {
  private readonly state: InstrumentationState;

  constructor(
    dependencies: Omit<
      InstrumentationState,
      "boundActionsByConcept" | "queryCaches" | "rawConceptsByInstrumented" | "concepts"
    >,
  ) {
    this.state = {
      ...dependencies,
      boundActionsByConcept: new WeakMap(),
      queryCaches: new WeakMap(),
      rawConceptsByInstrumented: new WeakMap(),
      concepts: new Set(),
    };
  }

  instrumentConcept<T extends object>(concept: T, name?: string): T {
    return instrumentConcept(this.state, concept, name);
  }

  instrument<T extends Record<string, object>>(concepts: T): T;
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object> | object): Record<string, object> | object {
    return instrument(this.state, concepts);
  }

  private invalidate(concept: object): void {
    const raw = this.rawConceptOf(concept);
    this.state.queryCaches.get(raw)?.forEach((cache) => cache.invalidate());
  }

  invalidateAll(): void {
    for (const ref of this.state.concepts) {
      const concept = ref.deref();
      if (concept !== undefined) this.invalidate(concept);
      else this.state.concepts.delete(ref);
    }
  }

  rawConceptOf(instrumented: object): object {
    return this.state.rawConceptsByInstrumented.get(instrumented) ?? instrumented;
  }
}
