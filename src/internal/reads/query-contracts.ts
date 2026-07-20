/** The promised number of rows a concept query may answer. */
export type QueryPromise = "one" | "optional" | "many";

import { conceptMetadataOf } from "../reactions/concept-metadata.ts";

export type QueryPromises = Readonly<Record<string, QueryPromise>>;

function staticQueryPromisesOf(concept: object): unknown {
  return (Object.getPrototypeOf(concept) as { constructor?: { queries?: unknown } })?.constructor
    ?.queries;
}

/** The optional promise declared for one query. An undeclared query may answer one record or an array. */
export function queryPromiseOf(concept: object, query: string): QueryPromise | undefined {
  const contracts = conceptMetadataOf(concept)?.queries ?? staticQueryPromisesOf(concept);
  if (contracts === undefined || contracts === null || typeof contracts !== "object")
    return undefined;
  return (contracts as Record<string, QueryPromise>)[query];
}

export function validateQueryContractMap(
  contracts: unknown,
  prototype: Record<string, unknown>,
  conceptName: string,
  className: string,
): void {
  if (contracts === undefined) return;
  if (contracts === null || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new Error(
      `${conceptName}: queries must map query names to "one", "optional", or "many".`,
    );
  }
  for (const [name, promise] of Object.entries(contracts)) {
    if (!name.startsWith("_") || typeof prototype[name] !== "function") {
      throw new Error(
        `${conceptName}: the queries contract names "${name}", which is not a query ` +
          `(a \`_\`-prefixed method) of ${className}.`,
      );
    }
    if (promise !== "one" && promise !== "optional" && promise !== "many") {
      throw new Error(
        `${conceptName}: the queries contract for "${name}" must be "one", "optional", or "many".`,
      );
    }
  }
}

/** Validate a concept's declared query promises while its vocabulary is assembled. */
export function validateQueryContracts(concept: object, conceptName: string): void {
  const cls = (
    Object.getPrototypeOf(concept) as { constructor?: { name?: string; queries?: unknown } }
  )?.constructor;
  const contracts = conceptMetadataOf(concept)?.queries ?? cls?.queries;
  validateQueryContractMap(
    contracts,
    Object.getPrototypeOf(concept) as Record<string, unknown>,
    conceptName,
    cls?.name ?? "the concept",
  );
}
