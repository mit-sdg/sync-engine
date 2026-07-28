import { FrameworkErrorCode } from "@engine/utils/framework-error-codes";
import { inspect, inspectCustom, uuid } from "@engine/utils/runtime";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { ActionConcept } from "./actions.ts";
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
import type { ActionScheduling } from "./action-scheduler.ts";
import { memoizeQuery } from "./query-cache.ts";

type ActionArguments = Record<string | symbol, unknown>;

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
 * faults reject. Queries retain their declared return shape.
 */
export type InstrumentedConcept<T extends object> = {
  [Key in keyof T]: T[Key] extends (...args: infer Args) => infer Result
    ? Key extends `_${string}`
      ? T[Key]
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
  registerConcept(name: string, instrumented: object): void;
  execution?: { action(flow: string): boolean };
  react(record: ActionRecord, durationMs?: number): Promise<void>;
  emit(record: ActionRecord, durationMs?: number): void;
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
        const withCache = memoizeQuery(value.bind(concept));
        const query = withCache as typeof withCache & {
          concept?: object;
          queryName?: string;
          queryLabel?: string;
          queryPromise?: import("@engine/reads/query-contracts").QueryPromise;
        };
        query.concept = concept;
        query.queryName = String(property);
        query.queryLabel = `${conceptNameOf(concept)}.${String(property)}`;
        query.queryPromise = queryPromiseOf(concept, String(property));
        boundActions.set(actionKey, withCache as unknown as InstrumentedAction);
        const caches = state.queryCaches.get(concept) ?? [];
        if (!state.queryCaches.has(concept)) state.queryCaches.set(concept, caches);
        caches.push(withCache);
        return withCache;
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
        invalidate();
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
        if (state.execution?.action(flowToken) === false) {
          state.actions._recordIntegrityFailure({
            kind: "execution-limit",
            flow: flowToken,
            limit: "actions",
            errorClass: "ExecutionLimitExceeded",
            at: Date.now(),
          });
          throw new Error("The flow exceeded its action limit.");
        }

        const record: ActionRecord = {
          id,
          action: instrumented as InstrumentedAction,
          concept,
          input,
          flow: flowToken,
          ...(typeof askedBy === "string" ? { by: askedBy } : {}),
        };
        state.actions._beginMatchingInput({ id, flow: flowToken, input });
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

          try {
            await state.react({ ...record });
          } catch (error) {
            logger.error("Reaction body failed after the action ask was recorded", {
              actionId: id,
              concept: concept.constructor.name,
              action: action.name,
              error: serializeError(error),
            });
          }
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
            if (isRefuse(error)) {
              output = refusalMapping(error);
              outcome = { kind: "error", error: output };
              warnUndeclaredRefusal(displayName, contract, error.message);
            } else {
              const refusal = refusalFor(concept, actionName, error);
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
                state.actions.faulted({ id, fault: errorOutputFromThrown(error) });
                report?.("fault-recorded");
                try {
                  await state.react({ ...record }, durationMs);
                } catch (immediateError) {
                  logger.error("Reaction body failed after the action fault was recorded", {
                    actionId: id,
                    concept: concept.constructor.name,
                    action: action.name,
                    error: serializeError(immediateError),
                  });
                  state.emit({ ...record }, durationMs);
                }
                throw error;
              }
            }
          }
          const durationMs = reservation.durationMs();
          state.actions.invoked({ id, output, outcome });
          try {
            await state.react({ ...record, output }, durationMs);
          } catch (error) {
            logger.error("Reaction body failed after the action outcome was recorded", {
              actionId: id,
              concept: concept.constructor.name,
              action: action.name,
              error: serializeError(error),
            });
            state.emit({ ...record, output }, durationMs);
          }
          return output;
        } finally {
          state.actions._endMatchingInput(flowToken);
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

export function instrument<T extends Record<string, object>>(
  state: InstrumentationState,
  concepts: T,
): T;
export function instrument<T extends object>(state: InstrumentationState, concept: T): T;
export function instrument(
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
  private readonly boundActionsByConcept = new WeakMap<
    object,
    Map<AnyAction, InstrumentedAction>
  >();
  private readonly queryCaches = new WeakMap<object, Array<{ invalidate: () => void }>>();
  private readonly rawConceptsByInstrumented = new WeakMap<object, object>();
  private readonly concepts = new Set<WeakRef<object>>();

  constructor(
    private readonly dependencies: {
      actions: ActionConcept;
      scheduler: ActionScheduling;
      execution?: { action(flow: string): boolean };
      react(record: ActionRecord, durationMs?: number): Promise<void>;
      emit(record: ActionRecord, durationMs?: number): void;
      registerConcept(name: string, instrumented: object): void;
    },
  ) {}

  instrumentConcept<T extends object>(concept: T, name?: string): T {
    return instrumentConcept(this.state(), concept, name);
  }

  instrument<T extends Record<string, object>>(concepts: T): T;
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object> | object): Record<string, object> | object {
    return instrument(this.state(), concepts);
  }

  invalidate(concept: object): void {
    const raw = this.rawConceptsByInstrumented.get(concept) ?? concept;
    this.queryCaches.get(raw)?.forEach((cache) => cache.invalidate());
  }

  invalidateAll(): void {
    for (const ref of this.concepts) {
      const concept = ref.deref();
      if (concept !== undefined) this.invalidate(concept);
      else this.concepts.delete(ref);
    }
  }

  rawConceptOf(instrumented: object): object {
    return this.rawConceptsByInstrumented.get(instrumented) ?? instrumented;
  }

  private state(): InstrumentationState {
    return {
      actions: this.dependencies.actions,
      boundActionsByConcept: this.boundActionsByConcept,
      queryCaches: this.queryCaches,
      scheduler: this.dependencies.scheduler,
      rawConceptsByInstrumented: this.rawConceptsByInstrumented,
      concepts: this.concepts,
      execution: this.dependencies.execution,
      react: this.dependencies.react,
      emit: this.dependencies.emit,
      registerConcept: this.dependencies.registerConcept,
    };
  }
}
