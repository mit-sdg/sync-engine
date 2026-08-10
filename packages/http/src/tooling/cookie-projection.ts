import type { WireProjectionFacts } from "@mit-sdg/sync-engine/boundary";
import type { WireContractsIR } from "@mit-sdg/sync-engine/tooling";
import { omitTopLevel, validateCookieBindings } from "../policy/cookies.ts";
import type { HttpPolicy } from "../policy/types.ts";

export function projectHttpCookies(
  facts: WireProjectionFacts,
  policy: HttpPolicy,
  source: WireContractsIR,
): WireContractsIR {
  const bindings = validateCookieBindings(facts, policy);
  return {
    endpoints: source.endpoints.map((endpoint) => {
      const omittedInput = new Set(
        bindings
          .filter((binding) => binding.protectedPaths.has(endpoint.path))
          .map((binding) => binding.binding.input),
      );
      const omittedOutput = new Set(
        bindings.flatMap((binding) =>
          binding.binding.issue
            .filter((issue) => issue.path === endpoint.path)
            .flatMap((issue) => [issue.value, issue.expires]),
        ),
      );
      return {
        ...endpoint,
        input:
          omittedInput.size === 0 ? endpoint.input : omitTopLevel(endpoint.input, omittedInput),
        output:
          omittedOutput.size === 0 ? endpoint.output : omitTopLevel(endpoint.output, omittedOutput),
      };
    }),
    appWide: source.appWide,
  };
}
