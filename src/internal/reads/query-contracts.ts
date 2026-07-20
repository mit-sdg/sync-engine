/** The promised number of rows a concept query may answer. */
export type QueryPromise = "one" | "optional" | "many";

/** The optional promise declared for one query. An undeclared query may answer one record or an array. */
export function queryPromiseOf(concept: object, query: string): QueryPromise | undefined {
  const contracts = (Object.getPrototypeOf(concept) as { constructor?: { queries?: unknown } })
    ?.constructor?.queries;
  if (contracts === undefined || contracts === null || typeof contracts !== "object")
    return undefined;
  return (contracts as Record<string, QueryPromise>)[query];
}

/** Validate a concept's declared query promises while its vocabulary is assembled. */
export function validateQueryContracts(concept: object, conceptName: string): void {
  const cls = (
    Object.getPrototypeOf(concept) as { constructor?: { name?: string; queries?: unknown } }
  )?.constructor;
  const contracts = cls?.queries;
  if (contracts === undefined) return;
  if (contracts === null || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new Error(
      `${conceptName}: static queries must map query names to "one", "optional", or "many".`,
    );
  }
  const prototype = Object.getPrototypeOf(concept) as Record<string, unknown>;
  for (const [name, promise] of Object.entries(contracts)) {
    if (!name.startsWith("_") || typeof prototype[name] !== "function") {
      throw new Error(
        `${conceptName}: the queries contract names "${name}", which is not a query ` +
          `(a \`_\`-prefixed method) of ${cls?.name ?? "the concept"}.`,
      );
    }
    if (promise !== "one" && promise !== "optional" && promise !== "many") {
      throw new Error(
        `${conceptName}: the queries contract for "${name}" must be "one", "optional", or "many".`,
      );
    }
  }
}
