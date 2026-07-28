/** Fail closed when local behavior reaches the request boundary, then validate its review. */

import type { AppIR } from "@engine/reads/ir";
import {
  analyzeLocalBehavior,
  compareLocalDefinitions,
  localDefinitionKey,
  reachableLocalDefinitions,
  type LocalBehaviorDefinition,
  type ObservedLocalDefinition,
} from "@engine/reads/local-behavior";
import {
  reviewLocalBehavior,
  type LocalBehaviorContract,
  type LocalBehaviorReview,
} from "@engine/reads/local-review";
import type { EndpointDeclaration } from "./endpoint-portability.ts";

function reactionBelongsToEndpoint(name: string, endpoint: EndpointDeclaration): boolean {
  return endpoint.reactions.some(
    (root) => name === root || name.startsWith(`${root}#`) || name.startsWith(`${root}:`),
  );
}

function renderLocal(definition: ObservedLocalDefinition): string {
  return `local ${definition.kind} "${definition.name}": ${definition.reasons.join("; ")}`;
}

export function assertApplicationLocality(
  owner: string,
  app: AppIR,
  endpoints: readonly EndpointDeclaration[],
  supplied: LocalBehaviorContract | undefined,
): LocalBehaviorReview {
  const analysis = analyzeLocalBehavior(app);
  const reactionNames = [
    ...app.reactions.map(({ name }) => name),
    ...app.unlowered.map(({ name }) => name),
  ];
  const failures: string[] = [];
  const endpointReactions = new Set<string>();

  for (const endpoint of endpoints) {
    const reached = new Map<string, ObservedLocalDefinition>();
    for (const name of reactionNames.filter((candidate) =>
      reactionBelongsToEndpoint(candidate, endpoint),
    )) {
      endpointReactions.add(name);
      for (const definition of reachableLocalDefinitions(analysis, { kind: "reaction", name })) {
        reached.set(localDefinitionKey(definition), definition);
      }
    }
    for (const definition of [...reached.values()].sort(compareLocalDefinitions)) {
      failures.push(
        `- endpoint "${endpoint.name}" at "${endpoint.path}" reaches ${renderLocal(definition)}`,
      );
    }
  }

  for (const name of analysis.boundaryReactions) {
    if (endpointReactions.has(name)) continue;
    const root: LocalBehaviorDefinition = { kind: "reaction", name };
    for (const definition of reachableLocalDefinitions(analysis, root)) {
      failures.push(
        `- ordinary reaction "${name}" touches RequestBoundary and reaches ${renderLocal(definition)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${owner}: local behavior cannot participate in request-boundary behavior; ` +
        "localBehavior has no endpoint override:\n" +
        failures.join("\n"),
    );
  }
  return reviewLocalBehavior(owner, analysis.localDefinitions, supplied);
}
