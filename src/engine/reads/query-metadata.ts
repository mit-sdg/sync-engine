/** Dependency-neutral query cardinality and diagnostic metadata. */

/** The promised number of rows a concept query may answer. */
export type QueryPromise = "one" | "optional" | "many";

export type QueryPromises = Readonly<Record<string, QueryPromise>>;

/** Metadata carried by instrumented and authored query references. */
export interface QueryMetadata {
  queryName?: string;
  queryLabel?: string;
  queryPromise?: QueryPromise;
}
