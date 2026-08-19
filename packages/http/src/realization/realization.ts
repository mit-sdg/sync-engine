import {
  bindInterface,
  createGateway,
  type EndpointDef,
  type InterfaceDefinition,
} from "@mit-sdg/sync-engine/boundary";
import type { Assembly } from "@mit-sdg/sync-engine/assembly";
import { createHttpHandler } from "../handler/handler.ts";

type AnyAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

export interface FetchClaim {
  readonly method: string;
  readonly path: string;
  readonly match?: "prefix";
  readonly declarations: readonly string[];
}

export interface FetchRealization {
  readonly interface: string;
  readonly claims: readonly FetchClaim[];
  fetch(request: Request): Promise<Response>;
}

const FetchRealizations = new WeakSet<object>();

export function isFetchRealization(value: unknown): value is FetchRealization {
  return typeof value === "object" && value !== null && FetchRealizations.has(value);
}

export function fetchClaimMatches(claim: FetchClaim, method: string, path: string): boolean {
  if (claim.method.toUpperCase() !== method.toUpperCase()) return false;
  return claim.match === "prefix"
    ? path.length > claim.path.length && path.startsWith(claim.path)
    : path === claim.path;
}

export function fetchClaimsOverlap(left: FetchClaim, right: FetchClaim): boolean {
  if (left.method.toUpperCase() !== right.method.toUpperCase()) return false;
  if (left.match === "prefix" && right.match === "prefix") {
    return left.path.startsWith(right.path) || right.path.startsWith(left.path);
  }
  if (left.match === "prefix") return fetchClaimMatches(left, right.method, right.path);
  if (right.match === "prefix") return fetchClaimMatches(right, left.method, left.path);
  return left.path === right.path;
}

/**
 * A checked Fetch value whose claim set may change while it is served — the
 * promotable Web realization uses this so an accepted promotion revises what
 * its paths serve without re-deploying. `claims` is read live on every
 * routing decision.
 */
export function defineLiveFetchRealization<
  T extends {
    readonly interface: string;
    fetch(request: Request): Promise<Response>;
  },
>(value: T & { claims(): readonly FetchClaim[] }): Omit<T, "claims"> & FetchRealization {
  const { claims, ...members } = value;
  const realization = Object.freeze(
    Object.defineProperties(members, {
      claims: {
        enumerable: true,
        get: () => claims(),
      },
    }),
  ) as unknown as Omit<T, "claims"> & FetchRealization;
  FetchRealizations.add(realization);
  return realization;
}

/** First-party realization floors use this constructor for checked Fetch values. */
export function defineFetchRealization(value: FetchRealization): FetchRealization {
  const realization: FetchRealization = Object.freeze({
    interface: value.interface,
    claims: Object.freeze(
      value.claims.map((claim) =>
        Object.freeze({
          method: claim.method,
          path: claim.path,
          ...(claim.match === undefined ? {} : { match: claim.match }),
          declarations: Object.freeze([...claim.declarations]),
        }),
      ),
    ),
    fetch: value.fetch,
  });
  FetchRealizations.add(realization);
  return realization;
}

/** Realize the selected interface as ordinary POST/JSON Fetch claims. */
export function realize(options: {
  system: AnyAssembly;
  interface: InterfaceDefinition;
}): FetchRealization {
  const selected = bindInterface(options);
  const gateway = createGateway({ application: options.system });
  const handler = createHttpHandler({ application: options.system, gateway });
  const declarationsByClaim = new Map<
    string,
    { path: string; match?: "prefix"; names: string[] }
  >();

  for (const member of selected.members) {
    if (member.kind !== "endpoint") continue;
    const { path, match } = member.value as EndpointDef;
    const key = `${match ?? "exact"}\0${path}`;
    const claim = declarationsByClaim.get(key) ?? {
      path,
      ...(match === undefined ? {} : { match }),
      names: [],
    };
    claim.names.push(member.identity);
    declarationsByClaim.set(key, claim);
  }

  const claims = Object.freeze(
    [...declarationsByClaim.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(({ path, match, names }) =>
        Object.freeze({
          method: "POST",
          path,
          ...(match === undefined ? {} : { match }),
          declarations: Object.freeze(names.sort((left, right) => left.localeCompare(right))),
        }),
      ),
  );
  return defineFetchRealization({
    interface: selected.identity,
    claims,
    async fetch(request: Request): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (!claims.some((claim) => fetchClaimMatches(claim, request.method, path))) {
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return handler(request);
    },
  });
}
