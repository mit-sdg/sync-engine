import type {
  WireProjection,
  WireContractsIR,
  WireProjectionResult,
} from "@mit-sdg/sync-engine/tooling";
import type { WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import { HTTP_PACKAGE_NAME, HTTP_PACKAGE_VERSION } from "../package-version.ts";
import type { HttpFloor } from "../server/floor.ts";
import { httpFloor, projectHttpWire, validateHttpFloor } from "../server/floor.ts";
import type { ProductionHttpProfile } from "../server/policy.ts";
import { productionHttpProfile } from "../server/policy.ts";
import { projectProductionHttpWire } from "../server/public-errors.ts";

export interface HttpWireOptions {
  readonly policy: ProductionHttpProfile | HttpFloor;
  readonly name: string;
}

function isFloor(policy: ProductionHttpProfile | HttpFloor): policy is HttpFloor {
  return "credential" in policy;
}

/** Derive the browser-visible contract from the same policy used by the handler. */
export function httpWire(options: HttpWireOptions): WireProjection {
  const policy = isFloor(options.policy)
    ? httpFloor(options.policy)
    : productionHttpProfile(options.policy);
  const name = options.name;
  return Object.freeze({
    provenance: Object.freeze({ name: HTTP_PACKAGE_NAME, version: HTTP_PACKAGE_VERSION }),
    project(facts: WireProjectionFacts): WireProjectionResult {
      if (isFloor(policy)) {
        validateHttpFloor(facts, policy);
        return {
          name,
          wire: projectHttpWire(facts, policy),
          render: { appWideErrorName: "HttpAppWideError" },
        };
      }
      return {
        name,
        wire: projectProductionHttpWire(
          structuredClone(facts.logicalWire) as WireContractsIR,
          policy,
        ),
        render: { appWideErrorName: "HttpAppWideError" },
      };
    },
  });
}
