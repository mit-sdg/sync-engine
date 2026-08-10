import type { WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import type {
  WireContractsIR,
  WireProjection,
  WireProjectionResult,
} from "@mit-sdg/sync-engine/tooling";
import { requireHttpPolicy } from "../policy/normalize.ts";
import type { HttpPolicy } from "../policy/types.ts";
import { HTTP_PACKAGE_NAME, HTTP_PACKAGE_VERSION } from "../package-version.ts";
import { projectHttpPublicErrors } from "../server/public-errors.ts";
import { projectHttpCookies } from "./cookie-projection.ts";

export interface HttpWireOptions {
  readonly policy?: HttpPolicy;
  readonly name: string;
}

/** Derive the browser-visible contract from the same policy used by the handler. */
export function httpWire(options: HttpWireOptions): WireProjection {
  const policy = requireHttpPolicy(options.policy, "httpWire");
  const name = options.name;
  return Object.freeze({
    provenance: Object.freeze({ name: HTTP_PACKAGE_NAME, version: HTTP_PACKAGE_VERSION }),
    project(facts: WireProjectionFacts): WireProjectionResult {
      const projected = projectHttpPublicErrors(
        structuredClone(facts.logicalWire) as WireContractsIR,
        policy,
      );
      return {
        name,
        wire:
          policy.cookies === undefined ? projected : projectHttpCookies(facts, policy, projected),
        render: { appWideErrorName: "HttpAppWideError" },
      };
    },
  });
}
