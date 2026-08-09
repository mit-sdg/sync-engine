import type { WireProjection, WireProjectionResult } from "@mit-sdg/sync-engine/tooling";
import type { WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import { HTTP_PACKAGE_NAME, HTTP_PACKAGE_VERSION } from "../package-version.ts";
import { projectHttpPolicyWire } from "../server/cookie-policy.ts";
import { httpPolicy, type HttpPolicy } from "../server/policy.ts";

export interface HttpWireOptions {
  readonly policy: HttpPolicy;
  readonly name: string;
}

/** Derive the browser-visible contract from the same policy used by the handler. */
export function httpWire(options: HttpWireOptions): WireProjection {
  const policy = httpPolicy(options.policy);
  const name = options.name;
  return Object.freeze({
    provenance: Object.freeze({ name: HTTP_PACKAGE_NAME, version: HTTP_PACKAGE_VERSION }),
    project(facts: WireProjectionFacts): WireProjectionResult {
      return {
        name,
        wire: projectHttpPolicyWire(facts, policy),
        render: { appWideErrorName: "HttpAppWideError" },
      };
    },
  });
}
