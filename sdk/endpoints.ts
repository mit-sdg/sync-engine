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

import type { InstrumentedAction, Mapping, Sync, ThenNode, WhenBuilder } from "@sync-engine/engine";
import { act, when } from "@sync-engine/engine";

const requestIdVar = Symbol("requestId");

// ── Phantom symbols ──────────────────────────────────────────────────────

declare const _contract: unique symbol;

// ── Schema interface ──────────────────────────────────────────────────────

export interface TypedSchema<T> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: "sync-engine";
    readonly validate: (
      value: unknown,
    ) => { readonly issues?: ReadonlyArray<{ readonly message: string }> } | { readonly value: T };
  };
}

export function unchecked<T>(): TypedSchema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "sync-engine",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

// ── Endpoint contract shape ──────────────────────────────────────────────

export interface EndpointContract {
  input?: object;
  output?: object;
  error?: object;
}

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ── Request-boundary actions ─────────────────────────────────────────────

export interface RequestBoundaryActions {
  request: InstrumentedAction;
  respond: InstrumentedAction;
}

// ── Endpoint helpers ─────────────────────────────────────────────────────

export interface EndpointHelpers {
  request(input?: Mapping): WhenBuilder;
  respond(body?: Mapping): ThenNode;
  fail(error?: unknown): ThenNode;
}

// ── Endpoint definition (internal) ───────────────────────────────────────

interface EndpointDefinition<
  TPath extends string,
  TInput extends object,
  TOutput extends object,
  TError extends object,
> {
  readonly path: TPath;
  readonly syncs: Record<string, Sync>;
  readonly [_contract]: {
    readonly [P in TPath]: {
      readonly input: TInput;
      readonly output: TOutput;
      readonly error: TError;
    };
  };
}

// ── ContractOf — walk a tree of endpoint definitions ├───────────────────

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

type EndpointContracts<T> =
  T extends EndpointDefinition<string, object, object, object>
    ? NonNullable<T[typeof _contract]>
    : T extends (...args: never[]) => unknown
      ? never
      : T extends readonly unknown[]
        ? EndpointContracts<T[number]>
        : T extends object
          ? EndpointContracts<T[keyof T]>
          : never;

export type ContractOf<T> = Prettify<UnionToIntersection<EndpointContracts<T>>>;

// ── createEndpointDsl ────────────────────────────────────────────────────

export function createEndpointDsl(boundary: RequestBoundaryActions) {
  function endpoint<
    const TPath extends string,
    const TContract extends EndpointContract = { input?: never; output?: never; error?: never },
  >(
    path: TPath,
    build: (helpers: EndpointHelpers) => Record<string, Sync>,
  ): EndpointDefinition<
    TPath,
    TContract["input"] extends object ? TContract["input"] : Record<string, never>,
    TContract["output"] extends object ? TContract["output"] : Record<string, never>,
    TContract["error"] extends object ? TContract["error"] : Record<string, never>
  > {
    const helpers: EndpointHelpers = {
      request: (input: Mapping = {}): WhenBuilder =>
        when(boundary.request, { ...input, path, requestId: requestIdVar }),

      respond: (body: Mapping = {}): ThenNode =>
        act(boundary.respond, { ...body, requestId: requestIdVar }),

      fail: (error: unknown = {}): ThenNode =>
        act(boundary.respond, {
          error,
          requestId: requestIdVar,
        }),
    };

    const syncFns = build(helpers);

    return { path, syncs: syncFns } as EndpointDefinition<
      TPath,
      TContract["input"] extends object ? TContract["input"] : Record<string, never>,
      TContract["output"] extends object ? TContract["output"] : Record<string, never>,
      TContract["error"] extends object ? TContract["error"] : Record<string, never>
    >;
  }

  return { endpoint, syncMap };
}

// ── syncMap — flatten nested endpoint definitions into a sync register ──

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
): value is EndpointDefinition<string, object, object, object> {
  return value !== null && typeof value === "object" && "path" in value && "syncs" in value;
}
