/** Dependency-neutral contracts and predicates for authored concept references. */

import type { QueryReadLine } from "@engine/reads/lines";
import type { QueryPromise } from "@engine/reads/query-metadata";
import type { Mapping, StepNode } from "../types.ts";
import { brand, hasFuncBrand } from "@engine/reads/brands";

const ActionRefBrand: unique symbol = Symbol("ActionRefBrand");
const QueryRefBrand: unique symbol = Symbol("QueryRefBrand");

/** A static reference to one concept action: `{ concept, action }` as data. */
export interface ActionRef {
  (input: Mapping): StepNode;
  readonly refConcept: string;
  readonly refAction: string;
}

/** A static reference to one concept query and its optional row promise. */
export interface QueryRef {
  (pattern: Mapping): QueryReadLine;
  readonly refConcept: string;
  readonly refQuery: string;
  readonly queryName: string;
  readonly queryPromise?: QueryPromise;
  readonly queryIdentity?: readonly string[];
}

export function brandActionRef<T extends object>(value: T): T {
  return brand(value, ActionRefBrand);
}

export function brandQueryRef<T extends object>(value: T): T {
  return brand(value, QueryRefBrand);
}

export function isActionRef(value: unknown): value is ActionRef {
  return hasFuncBrand(value, ActionRefBrand);
}

export function isQueryRef(value: unknown): value is QueryRef {
  return hasFuncBrand(value, QueryRefBrand);
}
