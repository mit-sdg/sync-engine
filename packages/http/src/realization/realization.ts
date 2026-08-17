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

/** First-party realization floors use this constructor for checked Fetch values. */
export function defineFetchRealization(value: FetchRealization): FetchRealization {
  const realization: FetchRealization = Object.freeze({
    interface: value.interface,
    claims: Object.freeze(
      value.claims.map((claim) =>
        Object.freeze({
          method: claim.method,
          path: claim.path,
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
  const declarationsByPath = new Map<string, string[]>();

  for (const member of selected.members) {
    if (member.kind !== "endpoint") continue;
    const path = (member.value as EndpointDef).path;
    const declarations = declarationsByPath.get(path) ?? [];
    declarations.push(member.identity);
    declarationsByPath.set(path, declarations);
  }

  const claims = Object.freeze(
    [...declarationsByPath]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, declarations]) =>
        Object.freeze({
          method: "POST",
          path,
          declarations: Object.freeze(
            declarations.sort((left, right) => left.localeCompare(right)),
          ),
        }),
      ),
  );
  const claimed = new Set(claims.map(({ path }) => path));
  return defineFetchRealization({
    interface: selected.identity,
    claims,
    async fetch(request: Request): Promise<Response> {
      if (!claimed.has(new URL(request.url).pathname)) {
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return handler(request);
    },
  });
}
