/** Endpoint-local type origins derived from registered reaction and read IR. */

import { asMarker } from "../reads/ir.ts";
import type {
  ActionTriggerIR,
  PatternIR,
  QueryRefIR,
  ReactionIR,
  ValueIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "../reads/ir.ts";

export type WireOrigin =
  | {
      source: "action-input" | "action-output" | "query-input" | "query-output";
      concept: string;
      member: string;
      path: string[];
    }
  | { source: "literal"; value: null | boolean | number | string }
  | { source: "number" };

export interface ProvenanceCell {
  alternatives: WireOrigin[][];
  maybe: boolean;
  presenceGroups: Set<string>;
  sites: Set<string>;
}

export type ProvenanceEnv = Map<string, ProvenanceCell>;

export interface ReactionProvenance {
  env: ProvenanceEnv;
  requestFields: Map<string, ProvenanceCell>;
}

type ConceptOrigin = Extract<WireOrigin, { concept: string }>;

function originKey(origin: WireOrigin): string {
  return JSON.stringify(origin);
}

function addOrigin(cell: ProvenanceCell, origin: WireOrigin, site: string): void {
  const key = originKey(origin);
  for (const alternative of cell.alternatives) {
    if (!alternative.some((existing) => originKey(existing) === key)) alternative.push(origin);
  }
  cell.sites.add(site);
}

function cell(env: ProvenanceEnv, name: string): ProvenanceCell {
  let found = env.get(name);
  if (found === undefined) {
    found = { alternatives: [[]], maybe: false, presenceGroups: new Set(), sites: new Set() };
    env.set(name, found);
  }
  return found;
}

export function sharedChildEnv(parent: ProvenanceEnv): ProvenanceEnv {
  return new Map(parent);
}

function detachedEnv(parent: ProvenanceEnv): ProvenanceEnv {
  const copies = new Map<ProvenanceCell, ProvenanceCell>();
  return new Map(
    [...parent].map(([name, source]) => {
      let copy = copies.get(source);
      if (copy === undefined) {
        copy = {
          alternatives: source.alternatives.map((alternative) => [...alternative]),
          maybe: source.maybe,
          presenceGroups: new Set(source.presenceGroups),
          sites: new Set(source.sites),
        };
        copies.set(source, copy);
      }
      return [name, copy];
    }),
  );
}

function at(origin: ConceptOrigin, key: string): ConceptOrigin {
  return { ...origin, path: [...origin.path, key] };
}

function variableName(value: ValueIR): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const marker = asMarker(value);
  return marker?.tag === "$var" ? (marker.payload as string) : undefined;
}

function patternMayBeAbsent(pattern: PatternIR, env: ProvenanceEnv): boolean {
  const visit = (value: ValueIR): boolean => {
    const name = variableName(value);
    if (name !== undefined) return env.get(name)?.maybe === true;
    if (Array.isArray(value)) return value.some(visit);
    if (typeof value !== "object" || value === null) return false;
    const marker = asMarker(value);
    if (marker !== null) {
      if (marker.tag === "$lit") {
        return Object.values(marker.payload as PatternIR).some(visit);
      }
      return false;
    }
    return Object.values(value).some(visit);
  };
  return Object.values(pattern).some(visit);
}

export function constrainPattern(
  env: ProvenanceEnv,
  pattern: PatternIR,
  origin: ConceptOrigin,
  site: string,
  options: { maybeFresh?: boolean; presenceGroup?: string } = {},
): void {
  const visit = (value: ValueIR, current: ConceptOrigin): void => {
    const name = variableName(value);
    if (name !== undefined) {
      const fresh = !env.has(name);
      const target = cell(env, name);
      addOrigin(target, current, site);
      if (fresh && options.maybeFresh === true) {
        target.maybe = true;
        if (options.presenceGroup !== undefined) {
          target.presenceGroups.add(options.presenceGroup);
        }
      }
      return;
    }
    if (Array.isArray(value) || typeof value !== "object" || value === null) return;
    const marker = asMarker(value);
    if (marker !== null) return;
    for (const [key, nested] of Object.entries(value)) visit(nested, at(current, key));
  };
  for (const [key, value] of Object.entries(pattern)) visit(value, at(origin, key));
}

function queryOrigin(source: "query-input" | "query-output", query: QueryRefIR): ConceptOrigin {
  return { source, concept: query.concept, member: query.query, path: [] };
}

export function applyQueryProvenance(
  env: ProvenanceEnv,
  query: QueryRefIR,
  input: PatternIR,
  output: PatternIR,
  posture: "required" | "optional" | "claim",
  site: string,
  options: { propagateInputAbsence?: boolean } = {},
): void {
  constrainPattern(env, input, queryOrigin("query-input", query), site);
  const scope = posture === "claim" ? sharedChildEnv(env) : env;
  const presenceGroup =
    posture === "optional" ? JSON.stringify({ site, query, input, output }) : undefined;
  constrainPattern(scope, output, queryOrigin("query-output", query), site, {
    maybeFresh:
      posture === "optional" ||
      (options.propagateInputAbsence === true && patternMayBeAbsent(input, env)),
    presenceGroup,
  });
}

function actionOrigin(
  source: "action-input" | "action-output",
  trigger: Pick<ActionTriggerIR, "concept" | "action">,
): ConceptOrigin {
  return { source, concept: trigger.concept, member: trigger.action, path: [] };
}

function analyzeActionTrigger(
  trigger: ActionTriggerIR,
  env: ProvenanceEnv,
  boundary: { concept: string; request: string },
  requestFields: Map<string, ProvenanceCell>,
  site: string,
): void {
  if (trigger.concept === boundary.concept && trigger.action === boundary.request) {
    for (const [key, value] of Object.entries(trigger.input)) {
      const name = variableName(value);
      if (name !== undefined) requestFields.set(key, cell(env, name));
    }
    return;
  }
  constrainPattern(env, trigger.input, actionOrigin("action-input", trigger), site);
  constrainPattern(env, trigger.output, actionOrigin("action-output", trigger), site);
}

function instantiateView(
  name: string,
  input: PatternIR,
  out: PatternIR,
  caller: ProvenanceEnv,
  views: ReadonlyMap<string, ViewIR>,
  visiting: ReadonlySet<string>,
  posture: "required" | "optional",
): void {
  if (visiting.has(name)) return;
  const definition = views.get(name);
  if (definition === undefined) return;
  const next = new Set(visiting);
  next.add(name);
  const alternatives: ProvenanceEnv[] = [];
  const locals: ProvenanceEnv[] = [];
  for (const alternative of definition.alternatives) {
    const branch = detachedEnv(caller);
    const local = instantiateEnv(input, branch);
    applyOpsProvenance(local, alternative, views, `${name} view`, next);
    alternatives.push(branch);
    locals.push(local);
  }
  const merge = (target: ProvenanceCell, branches: ProvenanceCell[]): void => {
    if (branches.length === 0) return;
    target.alternatives = branches.flatMap((source) => source.alternatives);
    target.maybe = branches.some((source) => source.maybe);
    target.presenceGroups = new Set(branches.flatMap((source) => [...source.presenceGroups]));
    target.sites = new Set(branches.flatMap((source) => [...source.sites]));
  };
  for (const [variable, target] of caller) {
    merge(
      target,
      alternatives
        .map((alternative) => alternative.get(variable))
        .filter((source): source is ProvenanceCell => source !== undefined),
    );
  }
  // A relation view binds outputs through `.is`: each caller variable in
  // the out pattern reads the view's own cell of the declared out name.
  for (const [outKey, value] of Object.entries(out)) {
    const callerName = variableName(value);
    if (callerName === undefined) continue;
    const fresh = !caller.has(callerName);
    const target = cell(caller, callerName);
    merge(
      target,
      locals
        .map((local) => local.get(outKey))
        .filter((source): source is ProvenanceCell => source !== undefined),
    );
    if (fresh && posture === "optional") target.maybe = true;
  }
}

export function applyOpsProvenance(
  env: ProvenanceEnv,
  ops: readonly (WhereOpIR | ViewOpIR)[],
  views: ReadonlyMap<string, ViewIR>,
  site: string,
  visiting: ReadonlySet<string> = new Set(),
): void {
  for (const op of ops) {
    switch (op.op) {
      case "find":
        if ("view" in op && op.view !== undefined) {
          instantiateView(op.view, op.in, op.out, env, views, visiting, "required");
        } else if (op.query !== undefined) {
          // A plain line binds only when a row matched: its outs are present.
          applyQueryProvenance(env, op.query, op.in, op.out, "required", site);
        }
        break;
      case "whether":
        if ("view" in op && op.view !== undefined) {
          instantiateView(op.view, op.in, op.out, env, views, visiting, "optional");
        } else if (op.query !== undefined) {
          // `whether` binds outputs or leaves them blank, so they may be absent.
          applyQueryProvenance(env, op.query, op.in, op.out, "optional", site);
        }
        break;
      case "no":
        if (op.query !== undefined) {
          applyQueryProvenance(env, op.query, op.in, op.out, "claim", site);
        }
        break;
      case "earlier":
      case "holds":
        break;
      case "count": {
        constrainPattern(env, op.in, queryOrigin("query-input", op.query), site);
        const target = cell(env, op.out);
        addOrigin(target, { source: "number" }, site);
        break;
      }
      case "compute":
      case "custom":
        break;
    }
  }
}

export function instantiateEnv(input: PatternIR, caller: ProvenanceEnv): ProvenanceEnv {
  const local: ProvenanceEnv = new Map();
  for (const [slot, value] of Object.entries(input)) {
    const name = variableName(value);
    if (name !== undefined) {
      local.set(slot, cell(caller, name));
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      const target = cell(local, slot);
      addOrigin(target, { source: "literal", value }, `slot ${slot}`);
    }
  }
  return local;
}

export function analyzeReactionProvenance(
  reaction: ReactionIR,
  boundary: { concept: string; request: string; respond: string },
  views: ReadonlyMap<string, ViewIR>,
): ReactionProvenance {
  const env: ProvenanceEnv = new Map();
  const requestFields = new Map<string, ProvenanceCell>();
  for (const trigger of reaction.when) {
    if (trigger.kind === "action") {
      analyzeActionTrigger(trigger, env, boundary, requestFields, `${reaction.name} when`);
    }
  }
  for (const op of reaction.where) {
    if (op.op === "earlier") {
      analyzeActionTrigger(op.when, env, boundary, requestFields, `${reaction.name} earlier`);
    } else {
      applyOpsProvenance(env, [op], views, `${reaction.name} where`);
    }
  }
  for (const consequence of reaction.then) {
    if (consequence.concept === boundary.concept && consequence.action === boundary.respond) {
      continue;
    }
    constrainPattern(
      env,
      consequence.input,
      {
        source: "action-input",
        concept: consequence.concept,
        member: consequence.action,
        path: [],
      },
      `${reaction.name} then`,
    );
  }
  return { env, requestFields };
}

export function referenceOf(
  target: ProvenanceCell | undefined,
): { alternatives: WireOrigin[][]; sites: string[]; maybe: boolean } | undefined {
  const distinct = new Map<string, WireOrigin[]>();
  for (const alternative of target?.alternatives ?? []) {
    const byOrigin = new Map(alternative.map((origin) => [originKey(origin), origin]));
    const normalized = [...byOrigin.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, origin]) => origin);
    if (normalized.length > 0) {
      distinct.set(normalized.map(originKey).join("\u0000"), normalized);
    }
  }
  const alternatives = [...distinct.values()].filter(
    (candidate, index, all) =>
      !all.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.length < candidate.length &&
          other.every((origin) =>
            candidate.some((member) => originKey(member) === originKey(origin)),
          ),
      ),
  );
  if (target === undefined || alternatives.length === 0) return undefined;
  return {
    alternatives: alternatives.map((alternative) => [...alternative]),
    sites: [...target.sites].sort(),
    maybe: target.maybe,
  };
}

export function referenceOfValue(
  value: ValueIR,
  env: ProvenanceEnv,
): { alternatives: WireOrigin[][]; sites: string[]; maybe: boolean } | undefined {
  const name = variableName(value);
  return name === undefined ? undefined : referenceOf(env.get(name));
}
