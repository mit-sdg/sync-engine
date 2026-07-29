/** The normalized type vocabulary shared by wire derivation and rendering. */

export type WireOrigin =
  | {
      source: "action-input" | "action-output" | "query-input" | "query-output";
      concept: string;
      member: string;
      path: string[];
    }
  | { source: "literal"; value: null | boolean | number | string }
  | { source: "number" };

export type WireType =
  | { kind: "json" }
  | { kind: "reference"; allOf: WireOrigin[]; sites: string[] }
  | { kind: "number" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "object"; fields: { key: string; type: WireType; optional?: boolean }[] }
  | { kind: "array"; of: WireType }
  | { kind: "union"; of: WireType[] };

export const JSON_TYPE: WireType = { kind: "json" };
const NULL_TYPE: WireType = { kind: "literal", value: null };

export function unresolvedWireLeaves(
  type: WireType,
  path: string,
  unionPath: (path: string, index: number) => string = (path) => path,
): string[] {
  if (type.kind === "json") return [path];
  if (type.kind === "object") {
    return type.fields.flatMap((field) =>
      unresolvedWireLeaves(field.type, `${path}.${field.key}`, unionPath),
    );
  }
  if (type.kind === "array") return unresolvedWireLeaves(type.of, `${path}[]`, unionPath);
  if (type.kind === "union") {
    return type.of.flatMap((member, index) =>
      unresolvedWireLeaves(member, unionPath(path, index), unionPath),
    );
  }
  return [];
}

function hasOneNullDifference(
  left: Extract<WireType, { kind: "object" }>,
  right: Extract<WireType, { kind: "object" }>,
): boolean {
  if (left.fields.length !== right.fields.length) return false;
  let differences = 0;
  for (let index = 0; index < left.fields.length; index += 1) {
    const leftField = left.fields[index];
    const rightField = right.fields[index];
    if (leftField.key !== rightField.key || leftField.optional !== rightField.optional)
      return false;
    if (JSON.stringify(leftField.type) === JSON.stringify(rightField.type)) continue;
    const leftIsNull = leftField.type.kind === "literal" && leftField.type.value === null;
    const rightIsNull = rightField.type.kind === "literal" && rightField.type.value === null;
    if (!leftIsNull && !rightIsNull) return false;
    differences += 1;
  }
  return differences === 1;
}

export function unionWireTypes(of: WireType[]): WireType {
  const flat: WireType[] = [];
  for (const type of of) {
    if (type.kind === "union") flat.push(...type.of);
    else flat.push(type);
  }
  const shaped: WireType[] = [];
  for (const candidate of flat) {
    if (candidate.kind !== "object") {
      shaped.push(candidate);
      continue;
    }
    const matching = shaped.find(
      (other): other is Extract<WireType, { kind: "object" }> =>
        other.kind === "object" && hasOneNullDifference(other, candidate),
    );
    if (matching === undefined) {
      shaped.push(candidate);
      continue;
    }
    matching.fields = matching.fields.map((field, index) => ({
      ...field,
      type: unionWireTypes([field.type, candidate.fields[index].type]),
    }));
  }
  const seen = new Set<string>();
  const distinct = shaped.filter((type) => {
    const key =
      type.kind === "reference"
        ? JSON.stringify({ kind: type.kind, allOf: type.allOf })
        : JSON.stringify(type);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const absorbed = distinct.filter((candidate, index, all) => {
    if (candidate.kind !== "reference") return true;
    const candidateKeys = new Set(candidate.allOf.map((origin) => JSON.stringify(origin)));
    return !all.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.kind === "reference" &&
        other.allOf.length < candidate.allOf.length &&
        other.allOf.every((origin) => candidateKeys.has(JSON.stringify(origin))),
    );
  });
  // Json absorbs everything except null, which remains an explicit absence value.
  if (absorbed.some((type) => type.kind === "json")) {
    const keepNull = absorbed.some((type) => type.kind === "literal" && type.value === null);
    return keepNull ? { kind: "union", of: [JSON_TYPE, NULL_TYPE] } : JSON_TYPE;
  }
  return absorbed.length === 1 ? absorbed[0] : { kind: "union", of: absorbed };
}

export function nullableWireType(type: WireType): WireType {
  return unionWireTypes([type, NULL_TYPE]);
}

export function referenceWireType(reference: {
  alternatives: WireOrigin[][];
  sites: string[];
}): WireType {
  return unionWireTypes(
    reference.alternatives.map((allOf) => ({
      kind: "reference" as const,
      allOf,
      sites: reference.sites,
    })),
  );
}

export function nullableWireLeaves(type: WireType): WireType {
  if (type.kind === "object") {
    return {
      kind: "object",
      fields: type.fields.map((field) => ({ ...field, type: nullableWireLeaves(field.type) })),
    };
  }
  return nullableWireType(type);
}
