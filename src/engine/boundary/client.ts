/**
 * Create a typed client from a generated contract and a transport.
 *
 * {@link createClient} infers endpoint inputs and results from its contract
 * type. Applications choose a transport at the call site with
 * `createClient<MyApi>({ transport })`.
 *
 * Two equivalent calling styles are supported, both terminating in a single
 * call to the transport:
 *
 * ```ts
 * const api = createClient<MyApi>({ transport });
 *
 * // grouped — property access mirrors the path segments
 * await api.auth.login({ username, password });
 * await api.admin.users.roles.assign({ userId, role });
 *
 * // indexed — the full path as a single key
 * await api["/auth/login"]({ username, password });
 * ```
 *
 * Both styles call the same transport:
 *
 * ```ts
 * transport({ path: "/auth/login", input: { username, password } });
 * ```
 */

import type { Prettify } from "./endpoints.ts";
import { FrameworkErrorCode } from "./errors.ts";
import type { EmittedFrameworkErrorCode } from "./errors.ts";

/** The normalized error envelope transports use for outside-world failures. */
export type ClientError = { error: EmittedFrameworkErrorCode; detail?: string };

/** A transport-agnostic request descriptor passed to {@link ClientTransport}. */
export interface ClientRequest {
  path: string;
  input: unknown;
}

/** A transport function that executes a {@link ClientRequest} and resolves to its result. */
export type ClientTransport<TError = ClientError> = (
  request: ClientRequest,
) => Promise<unknown | TError>;

/**
 * The structural shape any contract type must satisfy: a record mapping each
 * path to its `{ input; output; error }` triple. {@link createClient} is
 * generic over a concrete contract assignable to this.
 */
export type ContractShape = Record<string, { input: unknown; output: unknown; error?: unknown }>;

/** Options for {@link createClient}. */
export interface ClientOptions<TError = ClientError> {
  /** Transport function that executes endpoint calls. */
  transport: ClientTransport<TError>;
}

type ContractError<C extends ContractShape, P extends keyof C> = C[P] extends { error: infer E }
  ? E
  : never;

/** The value carried inside a wire error envelope. */
export type DomainErrorValue<T> = T extends { error: infer E } ? E : T;

type EndpointResult<C extends ContractShape, P extends keyof C, TError> =
  | C[P]["output"]
  | ContractError<C, P>
  | TError
  | ClientError;

/**
 * A terminal endpoint method: takes the path's typed input and resolves to its
 * success payload or the transport's result. When the contract declares an
 * empty input (`Record<string, never>`) the parameter is optional.
 */
export type Endpoint<C extends ContractShape, P extends keyof C, TError = ClientError> = [
  C[P]["input"],
] extends [Record<string, never>]
  ? (input?: C[P]["input"]) => Promise<EndpointResult<C, P, TError>>
  : (input: C[P]["input"]) => Promise<EndpointResult<C, P, TError>>;

/** The indexed surface: `client["/auth/login"](input)`. */
export type IndexedClient<C extends ContractShape, TError = ClientError> = {
  [P in keyof C & string]: Endpoint<C, P, TError>;
};

/**
 * The grouped surface: `client.auth.login(input)`. Works for paths of any
 * depth — `/admin/users/roles/assign` becomes `admin.users.roles.assign`.
 */
export type GroupedClient<C extends ContractShape, TError = ClientError> = Prettify<
  UnionToIntersection<AllPathChains<C, TError> | RemainderPathChain<keyof C & string, C, TError>>
>;

/** Flattens an intersection into a single object for readable IntelliSense. */
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

/**
 * Build a chain of nested property types for a single path.
 * `"/admin/users/roles/assign"` → `{ admin: { users: { roles: { assign: Endpoint } } } }`.
 */
type PathChain<
  P extends string,
  C extends ContractShape,
  TError = ClientError,
  FullPath extends keyof C & string = keyof C & string,
> = P extends `/${infer S}/${infer R}`
  ? { [K in S]: PathChain<`/${R}`, C, TError, FullPath> }
  : P extends `/${infer S}`
    ? { [K in S]: Endpoint<C, FullPath, TError> }
    : {};

type AllPathChains<
  C extends ContractShape,
  TError,
  P extends keyof C & string = keyof C & string,
> = P extends unknown ? PathChain<P, C, TError, P> : never;

/**
 * The first segment as a property and the remaining path as one key:
 * `client.roster["sections/create"](...)`.
 */
type RemainderPathChain<
  P extends keyof C & string,
  C extends ContractShape,
  TError = ClientError,
> = P extends `/${infer First}/${infer Rest}`
  ? { [K in First]: { [R in Rest]: Endpoint<C, P, TError> } }
  : {};

/**
 * The full client type for a contract `C`. Both calling styles coexist because
 * the contract paths (`/group/method`) cleanly split into a flat index and an
 * arbitrarily-deep grouped tree.
 */
export type Client<C extends ContractShape, TError = ClientError> = IndexedClient<C, TError> &
  GroupedClient<C, TError>;

/**
 * Builds the request path from accumulated proxy segments. A single segment
 * that already looks like a full path (`/auth/login`, used by the indexed
 * style) is taken verbatim; otherwise segments are joined (`["auth","login"]`
 * → `/auth/login`, the grouped style).
 */
function buildPath(segments: string[]): string {
  if (segments.length === 1 && segments[0].startsWith("/")) return segments[0];
  return `/${segments.join("/")}`;
}

/**
 * Creates a recursive, callable Proxy that accumulates path segments on
 * property access and issues the request when finally invoked. The target is a
 * function so the proxy is itself callable (supporting the terminal call) and
 * traps `get` for further segment accumulation.
 */
function makeProxy(
  segments: string[],
  call: (path: string, body: unknown) => Promise<unknown>,
): unknown {
  const fn = (body: unknown) => call(buildPath(segments), body);
  return new Proxy(fn, {
    get(_target, prop) {
      // The root client must not be thenable, but nested `then` is a valid
      // endpoint path segment (for example, `/auth/then`).
      if (typeof prop !== "string" || (prop === "then" && segments.length === 0)) return undefined;
      return makeProxy([...segments, prop], call);
    },
    apply(_target, _thisArg, args) {
      return call(buildPath(segments), args[0]);
    },
  });
}

/**
 * Creates a typed API client for a contract `C`. The returned value supports
 * both the grouped (`client.auth.login(...)`) and indexed
 * (`client["/auth/login"](...)`) styles, each fully inferred from `C`.
 *
 * Callers pass their application contract type and a transport, for example
 * `createClient<OperationsRoomWire>({ transport })`.
 */
export function createClient<C extends ContractShape, TError = ClientError>(
  options: ClientOptions<TError>,
): Client<C, TError> {
  const call = async (path: string, body: unknown) => {
    try {
      return await options.transport({ path, input: body ?? {} });
    } catch (e) {
      return {
        error: FrameworkErrorCode.TRANSPORT_ERROR,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  };
  return makeProxy([], call) as Client<C, TError>;
}
