/** Fail closed when ordinary assembly contains behavior that cannot travel as data. */

import type { AppIR } from "@engine/reads/ir";
import { analyzeLocalBehavior, type ObservedLocalDefinition } from "@engine/reads/local-behavior";

function renderLocal(definition: ObservedLocalDefinition): string {
  return `local ${definition.kind} "${definition.name}": ${definition.reasons.join("; ")}`;
}

export function assertApplicationLocality(owner: string, app: AppIR): void {
  const localDefinitions = analyzeLocalBehavior(app).localDefinitions;
  if (localDefinitions.length > 0) {
    throw new Error(
      `${owner}: ordinary assembly accepts portable behavior only:\n${localDefinitions
        .map((definition) => `- ${renderLocal(definition)}`)
        .join("\n")}`,
    );
  }
}
