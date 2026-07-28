/** Validate and render the explicit review contract for local application behavior. */

import { canonicalValue } from "@engine/utils/canonical-json";
import {
  compareLocalDefinitions,
  localDefinitionKey,
  type LocalBehaviorDefinition,
  type ObservedLocalDefinition,
} from "./local-behavior.ts";

export type { LocalBehaviorDefinition } from "./local-behavior.ts";

export interface LocalBehaviorContract {
  readonly revision: string;
  readonly definitions: readonly LocalBehaviorDefinition[];
}

export interface LocalBehaviorReview {
  contract: LocalBehaviorContract | null;
  observed: readonly ObservedLocalDefinition[];
}

function malformed(owner: string, detail: string): never {
  throw new Error(`${owner}: localBehavior ${detail}`);
}

function frozen<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) frozen(entry);
  return Object.freeze(value);
}

/** Validate exact, unique, canonical review inventory and return an immutable data snapshot. */
export function reviewLocalBehavior(
  owner: string,
  observed: readonly ObservedLocalDefinition[],
  supplied: LocalBehaviorContract | undefined,
): LocalBehaviorReview {
  if (observed.length === 0) {
    if (supplied !== undefined)
      malformed(owner, "contract is unused; this assembly has no local definitions.");
    return frozen({ contract: null, observed: [] });
  }
  if (supplied === undefined) {
    const definitions = observed
      .map(({ kind, name, reasons }) => `- ${kind} "${name}": ${reasons.join("; ")}`)
      .join("\n");
    throw new Error(
      `${owner}: executable local behavior requires an exact localBehavior review contract:\n${definitions}`,
    );
  }
  if (typeof supplied !== "object" || supplied === null || Array.isArray(supplied)) {
    malformed(owner, "must be an object with revision and definitions.");
  }
  if (Object.getPrototypeOf(supplied) !== Object.prototype) {
    malformed(owner, "must be a plain object with revision and definitions.");
  }
  const contractKeys = Object.keys(supplied).sort();
  if (
    contractKeys.length !== 2 ||
    contractKeys[0] !== "definitions" ||
    contractKeys[1] !== "revision"
  ) {
    malformed(owner, "must contain exactly revision and definitions.");
  }
  if (typeof supplied.revision !== "string" || supplied.revision.trim() === "") {
    malformed(owner, "revision must be a non-empty string.");
  }
  if (!Array.isArray(supplied.definitions)) {
    malformed(owner, "definitions must be an array.");
  }

  const definitions: LocalBehaviorDefinition[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of supplied.definitions.entries()) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      malformed(owner, `definitions[${index}] must contain exactly kind and name.`);
    }
    if (Object.getPrototypeOf(candidate) !== Object.prototype) {
      malformed(owner, `definitions[${index}] must be a plain object.`);
    }
    const keys = Object.keys(candidate).sort();
    if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "name") {
      malformed(owner, `definitions[${index}] must contain exactly kind and name.`);
    }
    if (!(["reaction", "view", "former"] as unknown[]).includes(candidate.kind)) {
      malformed(owner, `definitions[${index}].kind must be reaction, view, or former.`);
    }
    if (typeof candidate.name !== "string" || candidate.name.trim() === "") {
      malformed(owner, `definitions[${index}].name must be a non-empty string.`);
    }
    const definition = { kind: candidate.kind, name: candidate.name } as LocalBehaviorDefinition;
    const key = localDefinitionKey(definition);
    if (seen.has(key))
      malformed(owner, `inventory contains duplicate ${definition.kind} "${definition.name}".`);
    seen.add(key);
    definitions.push(definition);
  }
  const sorted = [...definitions].sort(compareLocalDefinitions);
  if (
    definitions.some(
      (definition, index) =>
        localDefinitionKey(definition) !==
        localDefinitionKey(sorted[index] as LocalBehaviorDefinition),
    )
  ) {
    malformed(owner, "definitions must be in canonical kind/name order.");
  }

  const expected = new Map(
    observed.map((definition) => [localDefinitionKey(definition), definition] as const),
  );
  const actual = new Map(
    definitions.map((definition) => [localDefinitionKey(definition), definition]),
  );
  const missing = [...expected]
    .filter(([key]) => !actual.has(key))
    .map(([, definition]) => `- missing ${definition.kind} "${definition.name}"`);
  const extra = [...actual]
    .filter(([key]) => !expected.has(key))
    .map(([, definition]) => `- stale or extra ${definition.kind} "${definition.name}"`);
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${owner}: localBehavior inventory does not exactly match observed local definitions:\n${[
        ...missing,
        ...extra,
      ].join("\n")}`,
    );
  }

  return frozen(
    canonicalValue({
      contract: { revision: supplied.revision, definitions },
      observed,
    }) as unknown as LocalBehaviorReview,
  );
}

export function renderLocalBehaviorReview(review: LocalBehaviorReview): string {
  if (review.observed.length === 0) return "";
  const lines = [
    `Reviewed local behavior — revision "${review.contract?.revision ?? "<missing>"}"`,
  ];
  for (const definition of review.observed) {
    lines.push(
      `  ${definition.kind} ${definition.name} — reviewed local: ${definition.reasons.join("; ")}`,
    );
  }
  return lines.join("\n");
}

export function renderLocalBehaviorMarkdown(review: LocalBehaviorReview): string {
  if (review.observed.length === 0) return "";
  return (
    "## Reviewed local behavior\n\n" +
    `Review revision: \`${review.contract?.revision ?? "<missing>"}\`\n\n` +
    review.observed
      .map(
        ({ kind, name, reasons }) =>
          `- \`${kind} ${name}\` — reviewed local: ${reasons.join("; ")}`,
      )
      .join("\n") +
    "\n"
  );
}
