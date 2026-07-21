import { FrameworkErrorCode } from "../utils/framework-error-codes.ts";
import { inspect, inspectCustom, uuid } from "../utils/runtime.ts";
import { logger } from "../utils/logger.ts";
import { serializeError } from "../utils/redaction.ts";
import { ActionConcept } from "./actions.ts";
import type { ActionRecord } from "./actions.ts";
import { registeredRefusalOf } from "./concept-metadata.ts";
import { CONCEPT_NAME, conceptNameOf } from "./introspect.ts";
import { contractOf } from "./outcomes.ts";
import type { ActionContract } from "./outcomes.ts";
import { isRefuse, refusalMapping } from "./refuse.ts";
import { actionId, byReaction, flow } from "./matching.ts";
import type { ActionOutcome, AnyAction, InstrumentedAction } from "./types.ts";
import { queryPromiseOf, validateQueryContracts } from "../reads/query-contracts.ts";

type ActionArguments = Record<string | symbol, unknown>;

type AnyFn = (...args: never[]) => unknown;

interface Memoized<T extends AnyFn> {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>;
  /** Drop every cached result. */
  invalidate: () => void;
}

/** A stable serialization of a value, so equal arguments produce equal keys. */
function stableKey(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${key}:${stableKey(record[key])}`).join(",")}}`;
  }
  if (typeof value === "string") return `s:${value}`;
  return `${typeof value}:${String(value)}`;
}

/**
 * Memoize a query by a stable serialization of its arguments. Queries read
 * standing state, so identical arguments return identical rows until the
 * state changes — `invalidate()` clears everything, and the engine calls it
 * on every action. No TTL or size bound: the working set is the reads issued
 * between two mutations. A rejected async query is never cached as a failure.
 */
function memoize<T extends AnyFn>(fn: T): Memoized<T> {
  let cache = new Map<string, unknown>();
  const wrapper = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const key = args.map(stableKey).join("|");
    if (cache.has(key)) return cache.get(key) as ReturnType<T>;
    const result = fn.call(this, ...args);
    cache.set(key, result);
    if (result instanceof Promise) {
      result.catch(() => {
        if (cache.get(key) === result) cache.delete(key);
      });
    }
    return result as ReturnType<T>;
  };
  wrapper.invalidate = () => {
    cache = new Map();
  };
  return wrapper as Memoized<T>;
}

export interface InstrumentationState {
  actions: ActionConcept;
  boundActionsByConcept: WeakMap<object, Map<AnyAction, InstrumentedAction>>;
  queryCaches: WeakMap<object, Array<{ invalidate: () => void }>>;
  actionLines: WeakMap<object, Promise<unknown>>;
  rawConceptsByInstrumented: WeakMap<object, object>;
  concepts: Set<WeakRef<object>>;
  conceptsByName: Map<string, object>;
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
        const withCache = memoize(value.bind(concept));
        const query = withCache as typeof withCache & {
          concept?: object;
          queryName?: string;
          queryLabel?: string;
          queryPromise?: import("../reads/query-contracts.ts").QueryPromise;
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
        let { [flow]: flowToken, [actionId]: id, [byReaction]: askedBy, ...input } = args;
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
          try {
            await state.react({ ...record });
          } catch (error) {
            logger.error("Reaction body failed after the action request was recorded", {
              actionId: id,
              concept: concept.constructor.name,
              action: action.name,
              error: serializeError(error),
            });
          }
          const started = performance.now();

          const prior = state.actionLines.get(concept);
          let run: Promise<unknown>;
          let bodyInFlight = true;
          if (prior === undefined) {
            try {
              const result = action(input);
              if (result instanceof Promise) run = result.finally(invalidate);
              else {
                invalidate();
                run = Promise.resolve(result);
                bodyInFlight = false;
              }
            } catch (error) {
              invalidate();
              run = Promise.reject(error);
              bodyInFlight = false;
            }
          } else {
            run = prior
              .then(
                () => undefined,
                () => undefined,
              )
              .then(async () => {
                try {
                  return await action(input);
                } finally {
                  invalidate();
                }
              });
          }
          if (bodyInFlight) {
            const tail: Promise<void> = run
              .then(
                () => undefined,
                () => undefined,
              )
              .then(() => {
                if (state.actionLines.get(concept) === tail) state.actionLines.delete(concept);
              });
            state.actionLines.set(concept, tail);
          }

          let output: Record<string, unknown>;
          let outcome: ActionOutcome | undefined;
          try {
            output = (await run) as Record<string, unknown>;
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
              const refusal = registeredRefusalOf(concept, actionName, error);
              if (refusal !== undefined) {
                output = {
                  error: refusal.code,
                  ...(refusal.error.message !== "" && refusal.error.message !== refusal.code
                    ? { detail: refusal.error.message }
                    : {}),
                };
                outcome = { kind: "error", error: output };
                warnUndeclaredRefusal(displayName, contract, refusal.code);
              } else {
                const durationMs = performance.now() - started;
                state.actions.faulted({ id, fault: errorOutputFromThrown(error) });
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
          const durationMs = performance.now() - started;
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
  const conceptName = conceptNameOf(concept);
  if (
    state.conceptsByName.has(conceptName) &&
    state.conceptsByName.get(conceptName) !== instrumentedConcept
  ) {
    logger.warn(
      `Two concepts share the name "${conceptName}" — exported reactions naming it will resolve to the most recently instrumented one.`,
    );
  }
  state.conceptsByName.set(conceptName, instrumentedConcept);
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
