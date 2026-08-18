import {
  callableConceptMember,
  CONCEPT_MEMBER_ROLES,
  conceptMetadataOf,
} from "@engine/reactions/concepts/concept-metadata";
import type { QueryPromise } from "./query-metadata.ts";

export type { QueryPromise, QueryPromises } from "./query-metadata.ts";

function staticQueryPromisesOf(concept: object): unknown {
  return (Object.getPrototypeOf(concept) as { constructor?: { queries?: unknown } })?.constructor
    ?.queries;
}

/** The optional promise declared for one query. An undeclared query may answer one record or an array. */
export function queryPromiseOf(concept: object, query: string): QueryPromise | undefined {
  const metadata = conceptMetadataOf(concept);
  const contracts =
    metadata?.[CONCEPT_MEMBER_ROLES] === undefined
      ? (metadata?.queries ?? staticQueryPromisesOf(concept))
      : metadata.queries;
  if (contracts === undefined || contracts === null || typeof contracts !== "object")
    return undefined;
  return (contracts as Record<string, QueryPromise>)[query];
}

/** The result fields that jointly identify one row of a declared many query. */
export function queryIdentityOf(concept: object, query: string): readonly string[] | undefined {
  const metadata = conceptMetadataOf(concept);
  const declared = metadata?.queryIdentities;
  if (declared !== undefined) return declared[query];
  const constructor = (
    Object.getPrototypeOf(concept) as {
      constructor?: { queryIdentities?: Readonly<Record<string, readonly string[]>> };
    }
  )?.constructor;
  return constructor?.queryIdentities?.[query];
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
    if (!name.startsWith("_") || callableConceptMember(prototype, name) === undefined) {
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

export function validateQueryIdentityMap(
  identities: unknown,
  promises: unknown,
  prototype: Record<string, unknown>,
  conceptName: string,
  className: string,
): void {
  if (identities === undefined) return;
  if (identities === null || typeof identities !== "object" || Array.isArray(identities)) {
    throw new Error(`${conceptName}: queryIdentities must map query names to result-field lists.`);
  }
  const contracts =
    promises !== null && typeof promises === "object"
      ? (promises as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  for (const [name, fields] of Object.entries(identities)) {
    if (!name.startsWith("_") || callableConceptMember(prototype, name) === undefined) {
      throw new Error(
        `${conceptName}: the queryIdentities contract names "${name}", which is not a query ` +
          `(a \`_\`-prefixed method) of ${className}.`,
      );
    }
    if (
      !Array.isArray(fields) ||
      fields.length === 0 ||
      fields.some((field) => typeof field !== "string" || field === "") ||
      new Set(fields).size !== fields.length
    ) {
      throw new Error(
        `${conceptName}: query identity for "${name}" must be a nonempty list of unique result-field names.`,
      );
    }
    if (contracts[name] !== "many") {
      throw new Error(
        `${conceptName}: query identity for "${name}" requires that query to promise "many".`,
      );
    }
  }
}

/** Validate a concept's declared query promises while its vocabulary is assembled. */
export function validateQueryContracts(concept: object, conceptName: string): void {
  const cls = (
    Object.getPrototypeOf(concept) as {
      constructor?: { name?: string; queries?: unknown; queryIdentities?: unknown };
    }
  )?.constructor;
  const metadata = conceptMetadataOf(concept);
  const contracts =
    metadata?.[CONCEPT_MEMBER_ROLES] === undefined
      ? (metadata?.queries ?? cls?.queries)
      : metadata.queries;
  validateQueryContractMap(
    contracts,
    concept as Record<string, unknown>,
    conceptName,
    cls?.name ?? "the concept",
  );
  validateQueryIdentityMap(
    metadata?.queryIdentities ?? cls?.queryIdentities,
    contracts,
    concept as Record<string, unknown>,
    conceptName,
    cls?.name ?? "the concept",
  );
}
