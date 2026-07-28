/** Dependency-neutral contracts and predicates for authored concept references. */

import type { QueryReadLine } from "@engine/reads/lines";
import type { QueryPromise } from "@engine/reads/query-metadata";
import type { Mapping, StepNode } from "../types.ts";

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
}

function brandReference<T extends object>(value: T, marker: symbol): T {
  Object.defineProperty(value, marker, { value: true, enumerable: false });
  return value;
}

export function brandActionRef<T extends object>(value: T): T {
  return brandReference(value, ActionRefBrand);
}

export function brandQueryRef<T extends object>(value: T): T {
  return brandReference(value, QueryRefBrand);
}

export function isActionRef(value: unknown): value is ActionRef {
  return typeof value === "function" && (value as never)[ActionRefBrand] === true;
}

export function isQueryRef(value: unknown): value is QueryRef {
  return typeof value === "function" && (value as never)[QueryRefBrand] === true;
}
