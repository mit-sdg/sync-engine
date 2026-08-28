/** Infer wire types for endpoint inputs, response values, and former trees. */

import type {
  AppIR,
  FormerIR,
  FormerNodeIR,
  JsonLiteral,
  PatternIR,
  ValueIR,
} from "@engine/reads/ir";
import { asMarker } from "@engine/reads/ir";
import type { InputContractDecl } from "../protocol/endpoints.ts";
import {
  applyOpsProvenance,
  instantiateEnv,
  referenceOf,
  referenceOfValue,
  sharedChildEnv,
} from "./wire-provenance.ts";
import type { ProvenanceCell, ProvenanceEnv } from "./wire-provenance.ts";
import {
  JSON_TYPE,
  nullableWireLeaves,
  nullableWireType,
  referenceWireType,
  unionWireTypes,
} from "./wire-types.ts";
import type { WireType } from "./wire-types.ts";
import { ordinal } from "@engine/utils/ordinal";

/**
 * Declared `required` keys are required `Json`; declared `defaults` are
 * optional; request literals remain required literal unions; other mentioned
 * keys are optional and use provenance when it resolves to a vocabulary leaf.
 */
export function inferInputWireType(
  patterns: PatternIR[],
  contract: InputContractDecl | undefined,
  origins: ReadonlyMap<string, ProvenanceCell[]>,
  reservedKeys: ReadonlySet<string>,
): WireType {
  const literals = new Map<string, WireType[]>();
  const mentioned = new Set<string>();
  for (const pattern of patterns) {
    for (const [key, value] of Object.entries(pattern)) {
      if (reservedKeys.has(key)) continue;
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        const forKey = literals.get(key) ?? [];
        forKey.push({ kind: "literal", value });
        literals.set(key, forKey);
      } else {
        mentioned.add(key);
      }
    }
  }

  const required = new Set(contract?.required ?? []);
  const defaults = contract?.defaults ?? {};
  const fields: { key: string; type: WireType; optional?: boolean }[] = [];
  const done = new Set<string>();

  const inferred = (key: string): WireType | undefined => {
    const candidates = (origins.get(key) ?? [])
      .map((source) => referenceOf(source))
      .filter((source) => source !== undefined)
      .map(referenceWireType);
    return candidates.length === 0 ? undefined : unionWireTypes(candidates);
  };

  for (const key of required) {
    fields.push({
      key,
      type: literals.has(key) ? unionWireTypes(literals.get(key)!) : (inferred(key) ?? JSON_TYPE),
    });
    done.add(key);
  }
  for (const key of Object.keys(defaults)) {
    if (done.has(key)) continue;
    fields.push({ key, type: inferred(key) ?? JSON_TYPE, optional: true });
    done.add(key);
  }
  for (const [key, variants] of literals) {
    if (done.has(key)) continue;
    fields.push({ key, type: unionWireTypes(variants) });
    done.add(key);
  }
  for (const key of mentioned) {
    if (done.has(key)) continue;
    fields.push({ key, type: inferred(key) ?? JSON_TYPE, optional: true });
    done.add(key);
  }
  fields.sort((left, right) => ordinal(left.key, right.key));
  return { kind: "object", fields };
}

export function inferPatternWireType(
  pattern: PatternIR,
  formers: ReadonlyMap<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string> = new Set(),
): WireType {
  const fields = Object.entries(pattern)
    .map(([key, value]) => ({
      key,
      type: inferValueWireType(value, formers, env, views, visiting),
    }))
    .sort((left, right) => ordinal(left.key, right.key));
  return { kind: "object", fields };
}

function inferValueWireType(
  value: ValueIR,
  formers: ReadonlyMap<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string>,
): WireType {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { kind: "literal", value };
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      of: unionWireTypes(
        value.map((item) => inferValueWireType(item, formers, env, views, visiting)),
      ),
    };
  }
  const marker = asMarker(value);
  if (marker !== null) {
    switch (marker.tag) {
      case "$var": {
        const reference = referenceOfValue(value, env);
        if (reference === undefined) return JSON_TYPE;
        const inferred = referenceWireType(reference);
        return reference.maybe ? nullableWireType(inferred) : inferred;
      }
      case "$former": {
        const ref = marker.payload as { name: string; in: PatternIR };
        const former = formers.get(ref.name);
        if (former === undefined || visiting.has(ref.name)) return JSON_TYPE;
        const next = new Set(visiting);
        next.add(ref.name);
        const local = instantiateEnv(ref.in, env);
        const type = inferFormerWireType(former.body, formers, local, views, next, ref.name);
        return former.promise === "optional" ? nullableWireType(type) : type;
      }
      case "$lit":
        return inferPatternWireType(
          marker.payload as Record<string, ValueIR>,
          formers,
          env,
          views,
          visiting,
        );
      default:
        return JSON_TYPE;
    }
  }
  return inferPatternWireType(value as PatternIR, formers, env, views, visiting);
}

function inferLiteralWireType(value: JsonLiteral): WireType {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { kind: "literal", value };
  }
  if (Array.isArray(value)) {
    return { kind: "array", of: unionWireTypes(value.map(inferLiteralWireType)) };
  }
  return {
    kind: "object",
    fields: Object.entries(value)
      .map(([key, field]) => ({ key, type: inferLiteralWireType(field) }))
      .sort((left, right) => ordinal(left.key, right.key)),
  };
}

/** Walk a former with the variable origins and optionality established by its reads. */
function inferFormerWireType(
  node: FormerNodeIR,
  formers: ReadonlyMap<string, FormerIR>,
  env: ProvenanceEnv,
  views: ReadonlyMap<string, AppIR["views"][number]>,
  visiting: ReadonlySet<string>,
  site: string,
): WireType {
  switch (node.node) {
    case "leaf": {
      const source = referenceOf(env.get(node.var));
      if (source === undefined) return JSON_TYPE;
      const inferred = referenceWireType(source);
      return source.maybe ? nullableWireType(inferred) : inferred;
    }
    case "literal":
      return inferLiteralWireType(node.value);
    case "count": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} count source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} count`);
      return { kind: "number" };
    }
    case "first": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} first source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} first`);
      const source = referenceOf(local.get(node.value));
      return nullableWireType(source === undefined ? JSON_TYPE : referenceWireType(source));
    }
    case "distinct": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} distinct source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} distinct`);
      const source = referenceOf(local.get(node.value));
      return {
        kind: "array",
        of: source === undefined ? JSON_TYPE : referenceWireType(source),
      };
    }
    case "each": {
      const local = sharedChildEnv(env);
      applyOpsProvenance(local, [node.from], views, `${site} each source`);
      applyOpsProvenance(local, node.where ?? [], views, `${site} each`);
      return {
        kind: "array",
        of: inferFormerWireType(node.as, formers, local, views, visiting, site),
      };
    }
    case "former": {
      const nested = formers.get(node.former);
      if (nested === undefined || visiting.has(node.former)) return JSON_TYPE;
      const next = new Set(visiting);
      next.add(node.former);
      const type = inferFormerWireType(
        nested.body,
        formers,
        instantiateEnv(node.in, env),
        views,
        next,
        node.former,
      );
      return node.whether ? nullableWireLeaves(type) : type;
    }
    case "record": {
      const inner = sharedChildEnv(env);
      applyOpsProvenance(inner, node.where ?? [], views, `${site} where`);
      const fields: { key: string; type: WireType; optional?: boolean }[] = [];
      for (const [key, child] of Object.entries(node.entries)) {
        fields.push({
          key,
          type: inferFormerWireType(child, formers, inner, views, visiting, site),
        });
      }
      for (const splice of node.splices ?? []) {
        const fragment = formers.get(splice.fragment);
        if (
          fragment === undefined ||
          fragment.body.node !== "record" ||
          visiting.has(splice.fragment)
        ) {
          continue;
        }
        const next = new Set(visiting);
        next.add(splice.fragment);
        const fragmentEnv = instantiateEnv(splice.in, inner);
        const fragmentType = inferFormerWireType(
          fragment.body,
          formers,
          fragmentEnv,
          views,
          next,
          splice.fragment,
        );
        if (fragmentType.kind !== "object") continue;
        for (const field of fragmentType.fields) {
          fields.push(
            splice.whether
              ? { key: field.key, type: nullableWireLeaves(field.type) }
              : { key: field.key, type: field.type },
          );
        }
      }
      fields.sort((left, right) => ordinal(left.key, right.key));
      return { kind: "object", fields };
    }
  }
}
