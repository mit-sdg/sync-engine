/**
 * The typed endpoint-authoring half of the SDK.
 *
 * Where {@link ./client.ts} is the client that *calls* endpoints, this module
 * is the authoring DSL that *defines* them and emits the `ContractShape` the
 * client is generic over. It builds on a request-boundary concept — any concept
 * exposing `request`/`respond` actions (see {@link RequestBoundaryActions}) —
 * turning it into a typed endpoint builder. The framework's generic
 * `Requesting` concept satisfies that contract natively; a different concept
 * can supply a thin adapter.
 */

import type {
  Frames,
  InstrumentedAction,
  Mapping,
  Sync,
  ThenClause,
  Vars,
} from "@sync-engine/engine";
import { type ActionList, type ActionPattern, actions } from "@sync-engine/engine";

declare const requestInput: unique symbol;
declare const responseOutput: unique symbol;
declare const endpointContract: unique symbol;

export type EmptyInput = Record<PropertyKey, never>;

/**
 * The error envelope stripped from an action's success type by {@link ActionOk}.
 * Apps with a richer error vocabulary (e.g. a domain error-code union) can pass
 * their own envelope as the `E` type parameter; the default matches any
 * `{ error: string }` result, which every concrete envelope is assignable to.
 */
export type ErrorEnvelope = { error: string; detail?: string };

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Fn<C, K extends keyof C> = C[K] extends (...args: never[]) => unknown ? C[K] : never;

export type ActionOk<C, K extends keyof C, E = ErrorEnvelope> = Exclude<
  Awaited<ReturnType<Fn<C, K>>>,
  E
>;

export type QueryRow<C, K extends keyof C> =
  Awaited<ReturnType<Fn<C, K>>> extends readonly (infer R)[] ? R : never;

type RequestInputMeta<TInput extends object> = {
  readonly [requestInput]: TInput;
};

type ResponseOutputMeta<TOutput> = {
  readonly [responseOutput]: TOutput;
};

/**
 * The request-boundary actions the endpoint DSL builds upon: a concept that
 * opens a request (`request`) and resolves it (`respond`). Any concept of this
 * shape can back the DSL — the framework's generic `Requesting` concept
 * satisfies it natively, others can supply a thin adapter.
 */
export interface RequestBoundaryActions {
  request: InstrumentedAction;
  respond: InstrumentedAction;
}

type EndpointSync<TInput extends object = never, TOutput = never> = Sync &
  RequestInputMeta<TInput> &
  ResponseOutputMeta<TOutput>;

interface EndpointDefinition<TPath extends string, TInput extends object, TOutput> {
  readonly path: TPath;
  readonly syncs: Record<string, Sync>;
  readonly [endpointContract]: {
    readonly [P in TPath]: {
      readonly input: TInput;
      readonly output: TOutput;
    };
  };
}

interface EndpointDsl {
  Request<const TInput extends Mapping>(
    input: TInput,
  ): ActionList & RequestInputMeta<RequestInputFromPattern<TInput>>;
  Request(): ActionList & RequestInputMeta<EmptyInput>;

  Respond<TOutput extends object>(body: Mapping): ActionList & ResponseOutputMeta<TOutput>;
  Respond<const TBody extends Mapping>(
    body: TBody,
  ): ActionList & ResponseOutputMeta<ResponseBodyFromPattern<TBody>>;

  Fail(error: unknown): ActionList & ResponseOutputMeta<never>;

  Actions<const TPatterns extends readonly ActionList[]>(
    ...patterns: TPatterns
  ): ActionPattern[] &
    RequestInputMeta<InputUnionFromPatterns<TPatterns>> &
    ResponseOutputMeta<OutputUnionFromPatterns<TPatterns>>;

  Sync<const TDeclaration extends EndpointSyncDeclaration>(
    fn: (vars: Vars) => TDeclaration,
  ): EndpointSync<InputFromDeclaration<TDeclaration>, OutputFromDeclaration<TDeclaration>>;
}

type EndpointSyncDeclaration = {
  when: ActionPattern[];
  where?: (frames: Frames) => Frames | Promise<Frames>;
  then: ThenClause;
};

type AllowableInput = string | string[] | number | boolean | undefined | null;

type RequestInputFromPattern<TInput extends Mapping> = Prettify<{
  [K in keyof TInput & string]: AllowableInput;
}>;

type ResponseBodyFromPattern<TBody extends Mapping> = Prettify<{
  [K in Exclude<keyof TBody, "request"> & string]: TBody[K];
}>;

type InputOf<T> = T extends RequestInputMeta<infer TInput> ? TInput : never;
type OutputOf<T> = T extends ResponseOutputMeta<infer TOutput> ? TOutput : never;

type InputUnionFromPatterns<TPatterns extends readonly unknown[]> = InputOf<TPatterns[number]>;
type OutputUnionFromPatterns<TPatterns extends readonly unknown[]> = OutputOf<TPatterns[number]>;

type InputFromDeclaration<TDeclaration extends EndpointSyncDeclaration> = InputOf<
  TDeclaration["when"]
>;
type OutputFromDeclaration<TDeclaration extends EndpointSyncDeclaration> = OutputOf<
  TDeclaration["then"]
>;

type EndpointInputFromSyncs<TSyncs extends Record<string, unknown>> = MergeInputUnion<
  InputOf<TSyncs[keyof TSyncs]>
>;
type EndpointOutputFromSyncs<TSyncs extends Record<string, unknown>> = OutputOf<
  TSyncs[keyof TSyncs]
>;

type KeysOfUnion<T> = T extends T ? keyof T : never;

type MergeInputUnion<TInput> = [KeysOfUnion<TInput>] extends [never]
  ? EmptyInput
  : Partial<
      Prettify<{
        [K in KeysOfUnion<TInput> & string]: AllowableInput;
      }>
    >;

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type EndpointContracts<T> =
  T extends EndpointDefinition<string, object, unknown>
    ? NonNullable<T[typeof endpointContract]>
    : T extends (...args: never[]) => unknown
      ? never
      : T extends readonly unknown[]
        ? EndpointContracts<T[number]>
        : T extends object
          ? EndpointContracts<T[keyof T]>
          : never;

export type ContractOf<T> = Prettify<UnionToIntersection<EndpointContracts<T>>>;

export function createEndpointDsl(boundary: RequestBoundaryActions) {
  function defineEndpoint<
    const TPath extends string,
    const TSyncs extends Record<string, EndpointSync<object, unknown>>,
  >(
    path: TPath,
    build: (helpers: EndpointDsl) => TSyncs,
  ): EndpointDefinition<TPath, EndpointInputFromSyncs<TSyncs>, EndpointOutputFromSyncs<TSyncs>> {
    let activeRequest: symbol | undefined;

    // SAFETY: The returned tuple structurally matches ActionList
    // ([InstrumentedAction, Mapping, Mapping?]) — `boundary.request` /
    // `boundary.respond` are the instrumented actions, the spread input /
    // body are the mappings. `RequestInputMeta` / `ResponseOutputMeta` add
    // phantom symbol-branded properties that exist only at the type level
    // and never affect runtime behaviour. The intermediate `as unknown` is
    // required because TypeScript sees no structural overlap between a
    // concrete tuple and a type branded with a unique-symbol property.
    const requestPattern = (input: Mapping, output: Mapping) =>
      [boundary.request, { path, ...input }, output] as unknown as ActionList &
        RequestInputMeta<object>;

    // SAFETY: Single `as` is sufficient here because TypeScript sees
    // structural overlap between the 2-element tuple and the
    // `ActionList & ResponseOutputMeta<object>` intersection — the
    // optional third element of ActionList allows structural matching.
    const respond = (body: Mapping) =>
      [boundary.respond, body] as ActionList & ResponseOutputMeta<object>;

    const getActiveRequest = (): symbol => {
      if (activeRequest === undefined) {
        throw new Error("Endpoint helper used outside Sync declaration construction.");
      }
      return activeRequest;
    };

    const Request = ((input: Mapping = {}) =>
      requestPattern(input, {
        request: getActiveRequest(),
      })) as EndpointDsl["Request"];
    // SAFETY: The Request overloads use phantom generics
    // (RequestInputFromPattern<TInput> / EmptyInput) that cannot be
    // expressed by a non-generic arrow function. The cast is safe because
    // the runtime behaviour is identical regardless of the phantom metadata
    // — `requestPattern` already returns a correct `ActionList` tuple, and
    // the symbol-branded `requestInput` property is stripped at runtime.

    const Respond = ((body: Mapping) =>
      respond({
        request: getActiveRequest(),
        ...body,
      })) as EndpointDsl["Respond"];
    // SAFETY: Same rationale as Request — phantom generic return types
    // (ResponseBodyFromPattern<TBody>) that a non-generic arrow function
    // cannot produce. The runtime value is a correct `ActionList` tuple;
    // the `responseOutput` brand exists only at compile time.

    const Fail = ((error: unknown) => {
      const body = isPlainMapping(error) ? error : { error };
      return respond({ request: getActiveRequest(), ...body }) as ActionList &
        ResponseOutputMeta<never>;
    }) as EndpointDsl["Fail"];
    // SAFETY: `Fail` returns an ActionList with ResponseOutputMeta<never>
    // (indicating no success output). The cast to `EndpointDsl["Fail"]` is
    // valid because the underlying function shape (parameter/return arity)
    // matches exactly; the phantom `never` brand has no runtime footprint.

    const Actions = ((...patterns: ActionList[]) => actions(...patterns)) as EndpointDsl["Actions"];
    // SAFETY: `actions(...)` returns `ActionPattern[]`. The `EndpointDsl`
    // signature additionally brands the result with phantom input/output
    // union metadata (InputUnionFromPatterns / OutputUnionFromPatterns).
    // These phantom properties exist only at the type level and are
    // inferred by the overload's const-generic; the runtime return value
    // is indistinguishable from `ActionPattern[]`.

    const Sync = ((fn: (vars: Vars) => EndpointSyncDeclaration) => {
      const sync = ((vars: Vars) => {
        const previousRequest = activeRequest;
        const request = vars.__request;
        activeRequest = request;

        try {
          const declaration = fn(vars);
          const [requestAnchor] = actions(requestPattern({}, { request }));
          return {
            ...declaration,
            when: [requestAnchor, ...declaration.when],
          };
        } finally {
          activeRequest = previousRequest;
        }
      }) as Sync;

      // SAFETY: The inner function is a valid `Sync` (engine SyncFunction)
      // by construction — its return type structurally matches
      // SyncDeclaration. We widen to `EndpointSync<object, unknown>` to
      // erase the specific phantom input/output types that the outer
      // `build()` generic will re-derive from the sync declarations.
      return sync as EndpointSync<object, unknown>;
    }) as EndpointDsl["Sync"];
    // SAFETY: The outer function shape matches `EndpointDsl["Sync"]`
    // parameter-for-parameter. The return type `EndpointSync<object, unknown>`
    // is the erased form; `build()`'s const-generic `TSyncs` infers the
    // actual input/output types from the sync bodies, so the erased inner
    // type is sound.

    const helpers: EndpointDsl = {
      Request,
      Respond,
      Fail,
      Actions,
      Sync,
    };

    const syncs = build(helpers);
    // SAFETY: `{ path, syncs }` structurally satisfies every field of
    // `EndpointDefinition` except the phantom `[endpointContract]` symbol
    // property, which carries the endpoint's input/output type contract
    // purely at the type level. The inner `syncs` values are already
    // correctly branded as `EndpointSync<object, unknown>` by the Sync
    // helper, and the const-generic parameters (TPath, TSyncs) capture the
    // literal path and sync record shape for downstream type inference.
    // The intermediate `as unknown` is required because TypeScript detects
    // no structural overlap between a plain object and a type branded with
    // a unique-symbol property.
    return { path, syncs } as unknown as EndpointDefinition<
      TPath,
      EndpointInputFromSyncs<TSyncs>,
      EndpointOutputFromSyncs<TSyncs>
    >;
  }

  return { defineEndpoint, syncMap };
}

export function syncMap(api: Record<string, unknown>): Record<string, Sync> {
  const out: Record<string, Sync> = {};

  function visit(value: unknown, prefix: string): void {
    if (isEndpointDefinition(value)) {
      for (const [name, sync] of Object.entries(value.syncs)) {
        out[prefix === "" ? name : `${prefix}.${name}`] = sync;
      }
      return;
    }

    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      visit(child, prefix === "" ? key : `${prefix}.${key}`);
    }
  }

  visit(api, "");
  return out;
}

function isEndpointDefinition(
  value: unknown,
): value is EndpointDefinition<string, object, unknown> {
  return value !== null && typeof value === "object" && "path" in value && "syncs" in value;
}

function isPlainMapping(value: unknown): value is Mapping {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
