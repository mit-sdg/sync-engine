import type { InputContractDecl } from "@engine/boundary/protocol/endpoints";
import type { WireType } from "@engine/boundary/wire/wire-types";
import type {
  AppIR,
  ComputationInventoryIR,
  ConceptImplementationProvenanceIR,
  ConceptSpecificationIR,
  FormerNodeIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  UnloweredIR,
  ViewOpIR,
  WhereOpIR,
} from "@engine/reads/ir";
import { canonicalDigest, canonicalValue } from "@engine/utils/canonical-json";
import { isAuthoredDeclarationPath, isDesignIdentifier } from "@engine/utils/design-identifiers";
import { setOwn } from "@engine/utils/own-property";
import { ordinal } from "@engine/utils/ordinal";
import { isSemVer, PACKAGE_NAME } from "@engine/utils/package-version";
import { ownedTypeNameSpellings, parseSimpleStateForm } from "@ssf";
import type { ApplicationDiagnostic } from "./diagnostics.ts";
import type { ApplicationManifestV1, ManifestEndpointV1 } from "./manifest.ts";
import { specificationTypeNameEvidence } from "./specification-type-evidence.ts";

type DataRecord = Record<string, unknown>;

const ACTION_POSTURES = ["requested", "returned", "refused", "faulted"] as const;
const CHANNEL_POSTURES = ["returned", "refused", "faulted"] as const;
const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error"] as const;
const DIAGNOSTIC_CODES = [
  "UNLOWERED_REACTION",
  "UNLOWERED_ENDPOINT",
  "OPAQUE_READ_OPERATION",
  "OPAQUE_PATTERN",
  "UNRESOLVED_WIRE_LEAF",
  "ENDPOINT_PATH_OVERLAP",
  "MISSING_ENDPOINT_FALLBACK",
  "ORDER_SENSITIVE_FORMER",
] as const;

/** Derive exact structural, evidenced-alias, and explicit-alias SSF names. */
export function specificationOwnedTypeNames(
  specification: ConceptSpecificationIR,
): readonly string[] {
  const parsed = parseSimpleStateForm(specification.state.body, {
    externalTypes: specification.externalTypes.map(({ name }) => name),
    evidenceTypeNames: specificationTypeNameEvidence(specification),
  });
  const errors = parsed.diagnostics.filter(({ severity }) => severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `authored design: concept definition ${JSON.stringify(specification.definitionName)} has invalid structural SSF State:\n${errors
        .map((diagnostic) => {
          const location =
            diagnostic.span === undefined
              ? specification.externalTypes.find(({ name }) => name === diagnostic.externalType)
                  ?.location
              : {
                  line: specification.state.location.line + diagnostic.span.start.line - 1,
                  column: specification.state.location.column + diagnostic.span.start.column - 1,
                };
          if (location === undefined)
            throw new Error(
              `SSF diagnostic names unknown external type ${JSON.stringify(diagnostic.externalType)}.`,
            );
          return `- line ${location.line}, column ${location.column}: [${diagnostic.code}] ${diagnostic.message}`;
        })
        .join("\n")}`,
    );
  }
  return [...ownedTypeNameSpellings(parsed.document.inventory)].sort(ordinal);
}

function fail(path: string, message: string): never {
  throw new TypeError(`Invalid application manifest at ${path}: ${message}.`);
}

function propertyPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

function assertJsonValue(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "expected a finite JSON number");
    return;
  }
  if (typeof value !== "object") fail(path, `expected JSON data, received ${typeof value}`);
  if (seen.has(value)) fail(path, "JSON data contains a cycle");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    fail(path, "expected a plain JSON object");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          fail(`${path}[${index}]`, "expected an enumerable JSON array element");
        }
        assertJsonValue(descriptor.value, `${path}[${index}]`, seen);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (
          typeof key !== "string" ||
          !/^(0|[1-9]\d*)$/u.test(key) ||
          Number(key) >= value.length
        ) {
          fail(path, "JSON arrays cannot contain non-index properties");
        }
      }
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail(path, "JSON objects cannot contain symbol keys");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        fail(propertyPath(path, key), "expected an enumerable data property");
      }
      assertJsonValue(descriptor.value, propertyPath(path, key), seen);
    }
  } finally {
    seen.delete(value);
  }
}

function record(value: unknown, path: string): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as DataRecord;
}

function shape(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): DataRecord {
  const data = record(value, path);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(data, key)) fail(propertyPath(path, key), "required property is missing");
  }
  for (const key of Object.keys(data)) {
    if (!allowed.has(key))
      fail(propertyPath(path, key), "property is not part of manifest version 1");
  }
  return data;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") fail(path, "expected a string");
}

function nonemptyString(value: unknown, path: string): asserts value is string {
  string(value, path);
  if (value.length === 0) fail(path, "expected a non-empty string");
}

function boolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
}

function designIdentifier(value: unknown, path: string): asserts value is string {
  nonemptyString(value, path);
  if (!isDesignIdentifier(value)) fail(path, "expected an authored identifier");
}

function literal<const Values extends readonly (string | number | boolean)[]>(
  value: unknown,
  path: string,
  values: Values,
): asserts value is Values[number] {
  if (!values.some((candidate) => candidate === value)) {
    fail(
      path,
      `expected one of ${values.map((candidate) => JSON.stringify(candidate)).join(", ")}`,
    );
  }
}

function integer(value: unknown, path: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `expected a safe integer greater than or equal to ${minimum}`);
  }
}

function strings(value: unknown, path: string): asserts value is string[] {
  for (const [index, item] of array(value, path).entries()) string(item, `${path}[${index}]`);
}

function uniqueNonemptyStrings(value: unknown, path: string): asserts value is string[] {
  const seen = new Set<string>();
  for (const [index, item] of array(value, path).entries()) {
    nonemptyString(item, `${path}[${index}]`);
    if (seen.has(item)) fail(`${path}[${index}]`, `duplicate value ${JSON.stringify(item)}`);
    seen.add(item);
  }
}

function assertPattern(value: unknown, path: string): asserts value is PatternIR {
  record(value, path);
}

function assertQueryReference(value: unknown, path: string): void {
  const data = shape(value, path, ["concept", "query"]);
  nonemptyString(data.concept, `${path}.concept`);
  nonemptyString(data.query, `${path}.query`);
}

function assertLineReference(data: DataRecord, path: string): void {
  const hasQuery = Object.hasOwn(data, "query");
  const hasView = Object.hasOwn(data, "view");
  if (hasQuery === hasView) fail(path, 'expected exactly one of "query" or "view"');
  if (hasQuery) assertQueryReference(data.query, `${path}.query`);
  if (hasView) nonemptyString(data.view, `${path}.view`);
}

function assertTrigger(value: unknown, path: string): asserts value is TriggerIR {
  const candidate = record(value, path);
  if (candidate.kind === "action") {
    const data = shape(
      value,
      path,
      ["kind", "concept", "action", "input", "output"],
      ["posture", "by"],
    );
    nonemptyString(data.concept, `${path}.concept`);
    nonemptyString(data.action, `${path}.action`);
    assertPattern(data.input, `${path}.input`);
    assertPattern(data.output, `${path}.output`);
    if (data.posture !== undefined) literal(data.posture, `${path}.posture`, ACTION_POSTURES);
    if (data.by !== undefined) nonemptyString(data.by, `${path}.by`);
    return;
  }
  if (candidate.kind === "channel") {
    const data = shape(value, path, ["kind", "channel", "pattern", "except"], ["exceptBy", "by"]);
    literal(data.channel, `${path}.channel`, CHANNEL_POSTURES);
    assertPattern(data.pattern, `${path}.pattern`);
    strings(data.except, `${path}.except`);
    if (data.exceptBy !== undefined) strings(data.exceptBy, `${path}.exceptBy`);
    if (data.by !== undefined) nonemptyString(data.by, `${path}.by`);
    return;
  }
  fail(`${path}.kind`, 'expected "action" or "channel"');
}

function assertWhereOperation(
  value: unknown,
  path: string,
  options: { readonly earlier: boolean; readonly count: boolean },
): asserts value is WhereOpIR | ViewOpIR {
  const candidate = record(value, path);
  switch (candidate.op) {
    case "find":
    case "whether": {
      const data = shape(value, path, ["op", "in", "out"], ["not", "query", "view"]);
      assertLineReference(data, path);
      assertPattern(data.in, `${path}.in`);
      assertPattern(data.out, `${path}.out`);
      if (data.not !== undefined) assertPattern(data.not, `${path}.not`);
      return;
    }
    case "no": {
      const data = shape(value, path, ["op", "in", "out"], ["query", "view"]);
      assertLineReference(data, path);
      assertPattern(data.in, `${path}.in`);
      assertPattern(data.out, `${path}.out`);
      return;
    }
    case "earlier": {
      if (!options.earlier) fail(`${path}.op`, '"earlier" is not allowed in this location');
      const data = shape(value, path, ["op", "when"]);
      assertTrigger(data.when, `${path}.when`);
      if ((data.when as { kind: string }).kind !== "action") {
        fail(`${path}.when.kind`, 'expected "action"');
      }
      return;
    }
    case "holds": {
      const data = shape(value, path, ["op", "computation", "in"]);
      nonemptyString(data.computation, `${path}.computation`);
      assertPattern(data.in, `${path}.in`);
      return;
    }
    case "compute": {
      const data = shape(value, path, ["op", "computation", "in", "out"]);
      nonemptyString(data.computation, `${path}.computation`);
      assertPattern(data.in, `${path}.in`);
      nonemptyString(data.out, `${path}.out`);
      return;
    }
    case "custom": {
      const data = shape(value, path, ["op", "fnRef", "opaque", "in", "out"]);
      nonemptyString(data.fnRef, `${path}.fnRef`);
      if (data.opaque !== true) fail(`${path}.opaque`, "expected true");
      strings(data.in, `${path}.in`);
      strings(data.out, `${path}.out`);
      return;
    }
    case "count": {
      if (!options.count) fail(`${path}.op`, '"count" is not allowed in this location');
      const data = shape(value, path, ["op", "query", "in", "out"]);
      assertQueryReference(data.query, `${path}.query`);
      assertPattern(data.in, `${path}.in`);
      nonemptyString(data.out, `${path}.out`);
      return;
    }
    default:
      fail(`${path}.op`, "expected a recognized read operation");
  }
}

function assertConsequence(value: unknown, path: string): void {
  const data = shape(value, path, ["kind", "concept", "action", "input"]);
  if (data.kind !== "request") fail(`${path}.kind`, 'expected "request"');
  nonemptyString(data.concept, `${path}.concept`);
  nonemptyString(data.action, `${path}.action`);
  assertPattern(data.input, `${path}.input`);
}

function assertAuthoredIdentity(value: unknown, path: string): void {
  const data = shape(value, path, ["kind", "identity"], ["source"]);
  literal(data.kind, `${path}.kind`, ["reaction", "view", "former"] as const);
  nonemptyString(data.identity, `${path}.identity`);
  if (!isAuthoredDeclarationPath(data.identity)) {
    fail(`${path}.identity`, "expected a dotted authored declaration path");
  }
  if (data.source !== undefined) {
    if (data.kind !== "reaction")
      fail(`${path}.source`, "endpoint provenance belongs to a reaction");
    literal(data.source, `${path}.source`, ["endpoint"] as const);
  }
}

function assertReactionBody(
  value: unknown,
  path: string,
  options: { readonly named: boolean; readonly patterns: boolean },
): void {
  const required = [
    ...(options.named ? ["name"] : []),
    "when",
    "where",
    "then",
    ...(options.patterns ? ["patterns"] : []),
  ];
  const data = shape(value, path, required, ["deferred", "authored"]);
  if (options.named) nonemptyString(data.name, `${path}.name`);
  if (data.authored !== undefined) assertAuthoredIdentity(data.authored, `${path}.authored`);
  if (data.deferred !== undefined && data.deferred !== true) {
    fail(`${path}.deferred`, "expected true when present");
  }
  for (const [index, trigger] of array(data.when, `${path}.when`).entries()) {
    assertTrigger(trigger, `${path}.when[${index}]`);
  }
  for (const [index, operation] of array(data.where, `${path}.where`).entries()) {
    assertWhereOperation(operation, `${path}.where[${index}]`, { earlier: true, count: false });
  }
  for (const [index, consequence] of array(data.then, `${path}.then`).entries()) {
    assertConsequence(consequence, `${path}.then[${index}]`);
  }
  if (options.patterns) {
    for (const [index, pattern] of array(data.patterns, `${path}.patterns`).entries()) {
      assertPattern(pattern, `${path}.patterns[${index}]`);
    }
  }
}

function assertReaction(value: unknown, path: string): asserts value is ReactionIR {
  assertReactionBody(value, path, { named: true, patterns: false });
}

function assertUnlowered(value: unknown, path: string): asserts value is UnloweredIR {
  const data = shape(value, path, ["name", "reason", "known"], ["authored"]);
  nonemptyString(data.name, `${path}.name`);
  if (data.authored !== undefined) assertAuthoredIdentity(data.authored, `${path}.authored`);
  nonemptyString(data.reason, `${path}.reason`);
  assertReactionBody(data.known, `${path}.known`, { named: false, patterns: true });
}

function assertView(value: unknown, path: string): void {
  const data = shape(
    value,
    path,
    ["name", "alternatives", "ins", "outs", "bindings"],
    ["promise", "holds", "authored"],
  );
  nonemptyString(data.name, `${path}.name`);
  if (data.authored !== undefined) assertAuthoredIdentity(data.authored, `${path}.authored`);
  strings(data.ins, `${path}.ins`);
  strings(data.outs, `${path}.outs`);
  strings(data.bindings, `${path}.bindings`);
  if (data.promise !== undefined) {
    literal(data.promise, `${path}.promise`, ["one", "optional", "many"] as const);
  }
  if (data.holds !== undefined && data.holds !== true) fail(`${path}.holds`, "expected true");
  for (const [alternativeIndex, alternative] of array(
    data.alternatives,
    `${path}.alternatives`,
  ).entries()) {
    for (const [operationIndex, operation] of array(
      alternative,
      `${path}.alternatives[${alternativeIndex}]`,
    ).entries()) {
      assertWhereOperation(
        operation,
        `${path}.alternatives[${alternativeIndex}][${operationIndex}]`,
        { earlier: false, count: true },
      );
    }
  }
}

function assertFormerSource(value: unknown, path: string): void {
  const data = shape(value, path, ["op", "in", "out"], ["not", "query", "view"]);
  if (data.op !== "find") fail(`${path}.op`, 'expected "find"');
  assertLineReference(data, path);
  assertPattern(data.in, `${path}.in`);
  assertPattern(data.out, `${path}.out`);
  if (data.not !== undefined) assertPattern(data.not, `${path}.not`);
}

function assertFormerWhere(value: unknown, path: string): void {
  for (const [index, operation] of array(value, path).entries()) {
    assertWhereOperation(operation, `${path}[${index}]`, { earlier: false, count: false });
  }
}

function assertArrangement(value: unknown, path: string): void {
  const candidate = record(value, path);
  if (Object.hasOwn(candidate, "by")) {
    const data = shape(value, path, ["by", "order"]);
    nonemptyString(data.by, `${path}.by`);
    literal(data.order, `${path}.order`, ["ascending", "descending"] as const);
    return;
  }
  const data = shape(value, path, ["order"]);
  literal(data.order, `${path}.order`, ["oldest", "newest"] as const);
}

function assertFormerNode(value: unknown, path: string): asserts value is FormerNodeIR {
  const candidate = record(value, path);
  switch (candidate.node) {
    case "leaf": {
      const data = shape(value, path, ["node", "var"]);
      nonemptyString(data.var, `${path}.var`);
      return;
    }
    case "record": {
      const data = shape(value, path, ["node", "entries"], ["where", "splices"]);
      if (data.where !== undefined) assertFormerWhere(data.where, `${path}.where`);
      for (const [key, entry] of Object.entries(record(data.entries, `${path}.entries`))) {
        assertFormerNode(entry, propertyPath(`${path}.entries`, key));
      }
      if (data.splices !== undefined) {
        for (const [index, splice] of array(data.splices, `${path}.splices`).entries()) {
          const splicePath = `${path}.splices[${index}]`;
          const spliceData = shape(splice, splicePath, ["fragment", "in"], ["whether"]);
          nonemptyString(spliceData.fragment, `${splicePath}.fragment`);
          assertPattern(spliceData.in, `${splicePath}.in`);
          if (spliceData.whether !== undefined && spliceData.whether !== true) {
            fail(`${splicePath}.whether`, "expected true");
          }
        }
      }
      return;
    }
    case "former": {
      const data = shape(value, path, ["node", "former", "in"], ["whether"]);
      nonemptyString(data.former, `${path}.former`);
      assertPattern(data.in, `${path}.in`);
      if (data.whether !== undefined && data.whether !== true) {
        fail(`${path}.whether`, "expected true");
      }
      return;
    }
    case "each": {
      const data = shape(value, path, ["node", "from", "as"], ["where", "arranged"]);
      assertFormerSource(data.from, `${path}.from`);
      if (data.where !== undefined) assertFormerWhere(data.where, `${path}.where`);
      if (data.arranged !== undefined) assertArrangement(data.arranged, `${path}.arranged`);
      assertFormerNode(data.as, `${path}.as`);
      return;
    }
    case "count": {
      const data = shape(value, path, ["node", "from"], ["where"]);
      assertFormerSource(data.from, `${path}.from`);
      if (data.where !== undefined) assertFormerWhere(data.where, `${path}.where`);
      return;
    }
    case "first": {
      const data = shape(value, path, ["node", "from", "value"], ["where", "arranged"]);
      assertFormerSource(data.from, `${path}.from`);
      nonemptyString(data.value, `${path}.value`);
      if (data.where !== undefined) assertFormerWhere(data.where, `${path}.where`);
      if (data.arranged !== undefined) assertArrangement(data.arranged, `${path}.arranged`);
      return;
    }
    case "distinct": {
      const data = shape(value, path, ["node", "from", "value"], ["where"]);
      assertFormerSource(data.from, `${path}.from`);
      nonemptyString(data.value, `${path}.value`);
      if (data.where !== undefined) assertFormerWhere(data.where, `${path}.where`);
      return;
    }
    default:
      fail(`${path}.node`, "expected a recognized former node");
  }
}

function assertFormer(value: unknown, path: string): void {
  const data = shape(value, path, ["name", "ins", "bindings", "promise", "body"], ["authored"]);
  nonemptyString(data.name, `${path}.name`);
  if (data.authored !== undefined) assertAuthoredIdentity(data.authored, `${path}.authored`);
  strings(data.ins, `${path}.ins`);
  strings(data.bindings, `${path}.bindings`);
  literal(data.promise, `${path}.promise`, ["one", "optional"] as const);
  assertFormerNode(data.body, `${path}.body`);
}

function assertApplication(value: unknown, path: string): asserts value is AppIR {
  const data = shape(value, path, ["reactions", "views", "formers", "unlowered"]);
  for (const [index, reaction] of array(data.reactions, `${path}.reactions`).entries()) {
    assertReaction(reaction, `${path}.reactions[${index}]`);
    const authored = record(reaction, `${path}.reactions[${index}]`).authored;
    if (
      authored !== undefined &&
      record(authored, `${path}.reactions[${index}].authored`).kind !== "reaction"
    )
      fail(`${path}.reactions[${index}].authored.kind`, 'expected "reaction"');
  }
  for (const [index, view] of array(data.views, `${path}.views`).entries()) {
    assertView(view, `${path}.views[${index}]`);
    const authored = record(view, `${path}.views[${index}]`).authored;
    if (
      authored !== undefined &&
      record(authored, `${path}.views[${index}].authored`).kind !== "view"
    )
      fail(`${path}.views[${index}].authored.kind`, 'expected "view"');
  }
  for (const [index, former] of array(data.formers, `${path}.formers`).entries()) {
    assertFormer(former, `${path}.formers[${index}]`);
    const authored = record(former, `${path}.formers[${index}]`).authored;
    if (
      authored !== undefined &&
      record(authored, `${path}.formers[${index}].authored`).kind !== "former"
    )
      fail(`${path}.formers[${index}].authored.kind`, 'expected "former"');
  }
  for (const [index, unlowered] of array(data.unlowered, `${path}.unlowered`).entries()) {
    assertUnlowered(unlowered, `${path}.unlowered[${index}]`);
    const authored = record(unlowered, `${path}.unlowered[${index}]`).authored;
    if (
      authored !== undefined &&
      record(authored, `${path}.unlowered[${index}].authored`).kind !== "reaction"
    )
      fail(`${path}.unlowered[${index}].authored.kind`, 'expected "reaction"');
  }
  uniqueFieldIndexes(data.reactions, `${path}.reactions`, "name");
  uniqueFieldIndexes(data.views, `${path}.views`, "name");
  uniqueFieldIndexes(data.formers, `${path}.formers`, "name");
  uniqueFieldIndexes(data.unlowered, `${path}.unlowered`, "name");
}

function assertLocation(value: unknown, path: string): void {
  const data = shape(value, path, ["line", "column"]);
  integer(data.line, `${path}.line`, 1);
  integer(data.column, `${path}.column`, 1);
}

function assertSpecificationType(value: unknown, path: string): void {
  const candidate = record(value, path);
  if (candidate.kind === "named") {
    const data = shape(value, path, ["kind", "name", "arguments", "location"]);
    nonemptyString(data.name, `${path}.name`);
    if (!data.name.split(".").every(isDesignIdentifier)) {
      fail(`${path}.name`, "expected a named type made of authored identifiers");
    }
    for (const [index, argument] of array(data.arguments, `${path}.arguments`).entries()) {
      assertSpecificationType(argument, `${path}.arguments[${index}]`);
    }
    assertLocation(data.location, `${path}.location`);
    return;
  }
  if (candidate.kind === "union") {
    const data = shape(value, path, ["kind", "members", "location"]);
    const members = array(data.members, `${path}.members`);
    if (members.length < 2) fail(`${path}.members`, "expected at least two union members");
    for (const [index, member] of members.entries()) {
      assertSpecificationType(member, `${path}.members[${index}]`);
    }
    assertLocation(data.location, `${path}.location`);
    return;
  }
  if (candidate.kind === "null" || candidate.kind === "undefined") {
    const data = shape(value, path, ["kind", "location"]);
    assertLocation(data.location, `${path}.location`);
    return;
  }
  fail(`${path}.kind`, "expected a recognized specification type");
}

function assertSpecificationField(value: unknown, path: string): void {
  const data = shape(value, path, ["name", "optional", "type", "location"]);
  designIdentifier(data.name, `${path}.name`);
  boolean(data.optional, `${path}.optional`);
  assertSpecificationType(data.type, `${path}.type`);
  assertLocation(data.location, `${path}.location`);
}

function assertSpecificationResult(value: unknown, path: string): void {
  const candidate = record(value, path);
  if (candidate.kind === "fields") {
    const data = shape(value, path, ["kind", "fields", "location"]);
    for (const [index, field] of array(data.fields, `${path}.fields`).entries()) {
      assertSpecificationField(field, `${path}.fields[${index}]`);
    }
    uniqueFieldIndexes(data.fields, `${path}.fields`, "name");
    assertLocation(data.location, `${path}.location`);
    return;
  }
  if (candidate.kind === "type") {
    const data = shape(value, path, ["kind", "type", "location"]);
    assertSpecificationType(data.type, `${path}.type`);
    assertLocation(data.location, `${path}.location`);
    return;
  }
  fail(`${path}.kind`, 'expected "fields" or "type"');
}

function assertSpecification(
  value: unknown,
  path: string,
): asserts value is ConceptSpecificationIR {
  const data = shape(value, path, [
    "format",
    "version",
    "definitionName",
    "purpose",
    "principle",
    "externalTypes",
    "state",
    "actions",
    "queries",
  ]);
  if (data.format !== "sync-engine.concept-specification") {
    fail(`${path}.format`, 'expected "sync-engine.concept-specification"');
  }
  if (data.version !== 1) fail(`${path}.version`, "expected 1");
  designIdentifier(data.definitionName, `${path}.definitionName`);
  nonemptyString(data.purpose, `${path}.purpose`);
  nonemptyString(data.principle, `${path}.principle`);
  for (const [index, external] of array(data.externalTypes, `${path}.externalTypes`).entries()) {
    const externalPath = `${path}.externalTypes[${index}]`;
    const item = shape(external, externalPath, ["name", "explanation", "location"]);
    designIdentifier(item.name, `${externalPath}.name`);
    string(item.explanation, `${externalPath}.explanation`);
    assertLocation(item.location, `${externalPath}.location`);
  }
  uniqueFieldIndexes(data.externalTypes, `${path}.externalTypes`, "name");
  const state = shape(data.state, `${path}.state`, ["body", "location"]);
  string(state.body, `${path}.state.body`);
  assertLocation(state.location, `${path}.state.location`);
  const parsedActions = array(data.actions, `${path}.actions`);
  if (parsedActions.length === 0) fail(`${path}.actions`, "expected at least one action");
  for (const [index, action] of parsedActions.entries()) {
    const actionPath = `${path}.actions[${index}]`;
    const item = shape(action, actionPath, [
      "name",
      "inputs",
      "parameters",
      "result",
      "body",
      "refusals",
      "location",
    ]);
    designIdentifier(item.name, `${actionPath}.name`);
    if ((item.name as string).startsWith("_"))
      fail(`${actionPath}.name`, "action names cannot begin with an underscore");
    uniqueNonemptyStrings(item.inputs, `${actionPath}.inputs`);
    for (const [fieldIndex, field] of array(item.parameters, `${actionPath}.parameters`).entries())
      assertSpecificationField(field, `${actionPath}.parameters[${fieldIndex}]`);
    const parameterIndexes = uniqueFieldIndexes(
      item.parameters,
      `${actionPath}.parameters`,
      "name",
    );
    if (!sameCanonicalValue(item.inputs, [...parameterIndexes.keys()]))
      fail(`${actionPath}.inputs`, "does not match parameter names and order");
    assertSpecificationResult(item.result, `${actionPath}.result`);
    if (record(item.result, `${actionPath}.result`).kind !== "fields")
      fail(`${actionPath}.result.kind`, 'expected "fields"');
    string(item.body, `${actionPath}.body`);
    for (const [refusalIndex, refusal] of array(
      item.refusals,
      `${actionPath}.refusals`,
    ).entries()) {
      const refusalPath = `${actionPath}.refusals[${refusalIndex}]`;
      const refusalItem = shape(refusal, refusalPath, ["code", "message", "location"]);
      nonemptyString(refusalItem.code, `${refusalPath}.code`);
      if (/\s/u.test(refusalItem.code as string))
        fail(`${refusalPath}.code`, "refusal codes cannot contain whitespace");
      nonemptyString(refusalItem.message, `${refusalPath}.message`);
      assertLocation(refusalItem.location, `${refusalPath}.location`);
    }
    uniqueFieldIndexes(item.refusals, `${actionPath}.refusals`, "code");
    assertLocation(item.location, `${actionPath}.location`);
  }
  uniqueFieldIndexes(data.actions, `${path}.actions`, "name");
  for (const [index, query] of array(data.queries, `${path}.queries`).entries()) {
    const queryPath = `${path}.queries[${index}]`;
    const item = shape(query, queryPath, [
      "name",
      "inputs",
      "parameters",
      "result",
      "body",
      "promise",
      "location",
    ]);
    designIdentifier(item.name, `${queryPath}.name`);
    if (!(item.name as string).startsWith("_"))
      fail(`${queryPath}.name`, "query names must begin with an underscore");
    uniqueNonemptyStrings(item.inputs, `${queryPath}.inputs`);
    for (const [fieldIndex, field] of array(item.parameters, `${queryPath}.parameters`).entries())
      assertSpecificationField(field, `${queryPath}.parameters[${fieldIndex}]`);
    const parameterIndexes = uniqueFieldIndexes(item.parameters, `${queryPath}.parameters`, "name");
    if (!sameCanonicalValue(item.inputs, [...parameterIndexes.keys()]))
      fail(`${queryPath}.inputs`, "does not match parameter names and order");
    assertSpecificationResult(item.result, `${queryPath}.result`);
    if (record(item.result, `${queryPath}.result`).kind !== "fields")
      fail(`${queryPath}.result.kind`, 'expected "fields"');
    string(item.body, `${queryPath}.body`);
    literal(item.promise, `${queryPath}.promise`, ["one", "optional", "many"] as const);
    assertLocation(item.location, `${queryPath}.location`);
  }
  uniqueFieldIndexes(data.queries, `${path}.queries`, "name");
}

function assertConcept(value: unknown, path: string): void {
  const data = shape(
    value,
    path,
    ["name", "actions", "queries"],
    ["purpose", "principle", "specification"],
  );
  nonemptyString(data.name, `${path}.name`);
  if (data.purpose !== undefined) string(data.purpose, `${path}.purpose`);
  if (data.principle !== undefined) string(data.principle, `${path}.principle`);
  for (const [index, action] of array(data.actions, `${path}.actions`).entries()) {
    const actionPath = `${path}.actions[${index}]`;
    const actionData = shape(action, actionPath, ["name"], ["roles", "refusals"]);
    nonemptyString(actionData.name, `${actionPath}.name`);
    if (actionData.roles !== undefined) {
      uniqueNonemptyStrings(actionData.roles, `${actionPath}.roles`);
    }
    if (actionData.refusals !== undefined) strings(actionData.refusals, `${actionPath}.refusals`);
  }
  for (const [index, query] of array(data.queries, `${path}.queries`).entries()) {
    const queryPath = `${path}.queries[${index}]`;
    const queryData = shape(query, queryPath, ["name"], ["roles", "returns"]);
    nonemptyString(queryData.name, `${queryPath}.name`);
    if (queryData.roles !== undefined) {
      uniqueNonemptyStrings(queryData.roles, `${queryPath}.roles`);
    }
    if (queryData.returns !== undefined) {
      literal(queryData.returns, `${queryPath}.returns`, ["one", "optional", "many"] as const);
    }
  }
  if (data.specification !== undefined) {
    assertSpecification(data.specification, `${path}.specification`);
  }
}

function assertComputation(value: unknown, path: string): asserts value is ComputationInventoryIR {
  const data = shape(value, path, ["name", "source"], ["inputs"]);
  nonemptyString(data.name, `${path}.name`);
  literal(data.source, `${path}.source`, ["standard", "vocabulary"] as const);
  if (data.inputs !== undefined) uniqueNonemptyStrings(data.inputs, `${path}.inputs`);
}

function assertConstructorName(value: unknown, path: string): void {
  nonemptyString(value, path);
  if (value === "Object") fail(path, 'expected structural "Object" values to omit constructorName');
}

function assertConceptImplementation(
  value: unknown,
  path: string,
): asserts value is ConceptImplementationProvenanceIR {
  const data = shape(value, path, ["concept", "canonical", "selected"]);
  nonemptyString(data.concept, `${path}.concept`);
  const canonical = shape(data.canonical, `${path}.canonical`, ["owner"], ["constructorName"]);
  literal(canonical.owner, `${path}.canonical.owner`, ["core", "application"] as const);
  if (canonical.constructorName !== undefined) {
    assertConstructorName(canonical.constructorName, `${path}.canonical.constructorName`);
  }

  const selectedPath = `${path}.selected`;
  const candidate = record(data.selected, selectedPath);
  if (candidate.via === "instances") {
    const selected = shape(data.selected, selectedPath, ["via"], ["constructorName", "floor"]);
    if (selected.constructorName !== undefined) {
      assertConstructorName(selected.constructorName, `${selectedPath}.constructorName`);
    }
    if (selected.floor !== undefined) nonemptyString(selected.floor, `${selectedPath}.floor`);
    return;
  }
  if (["core", "default", "initialize"].includes(candidate.via as string)) {
    const selected = shape(data.selected, selectedPath, ["via"]);
    literal(selected.via, `${selectedPath}.via`, ["core", "default", "initialize"] as const);
    return;
  }
  fail(`${selectedPath}.via`, "expected a recognized implementation selection");
}

function assertInputContract(value: unknown, path: string): asserts value is InputContractDecl {
  const data = shape(value, path, [], ["required", "defaults"]);
  if (data.required !== undefined) uniqueNonemptyStrings(data.required, `${path}.required`);
  if (data.defaults !== undefined) record(data.defaults, `${path}.defaults`);
}

function assertManifestEndpoint(value: unknown, path: string): asserts value is ManifestEndpointV1 {
  const data = shape(value, path, ["name", "path", "reactions", "input", "validators"]);
  nonemptyString(data.name, `${path}.name`);
  nonemptyString(data.path, `${path}.path`);
  uniqueNonemptyStrings(data.reactions, `${path}.reactions`);
  assertInputContract(data.input, `${path}.input`);
  const validators = shape(
    data.validators,
    `${path}.validators`,
    ["input", "output"],
    ["domainError"],
  );
  boolean(validators.input, `${path}.validators.input`);
  boolean(validators.output, `${path}.validators.output`);
  if (validators.domainError !== undefined && validators.domainError !== true) {
    fail(`${path}.validators.domainError`, "expected true when present");
  }
}

function assertWireOrigin(value: unknown, path: string): void {
  const candidate = record(value, path);
  if (candidate.source === "literal") {
    const data = shape(value, path, ["source", "value"]);
    if (
      data.value !== null &&
      typeof data.value !== "string" &&
      typeof data.value !== "number" &&
      typeof data.value !== "boolean"
    ) {
      fail(`${path}.value`, "expected a JSON scalar");
    }
    return;
  }
  if (candidate.source === "number") {
    shape(value, path, ["source"]);
    return;
  }
  if (candidate.source === "computation-input" || candidate.source === "computation-output") {
    const data = shape(value, path, ["source", "computation", "path"]);
    nonemptyString(data.computation, `${path}.computation`);
    strings(data.path, `${path}.path`);
    return;
  }
  literal(candidate.source, `${path}.source`, [
    "action-input",
    "action-output",
    "query-input",
    "query-output",
  ] as const);
  const data = shape(value, path, ["source", "concept", "member", "path"]);
  nonemptyString(data.concept, `${path}.concept`);
  nonemptyString(data.member, `${path}.member`);
  strings(data.path, `${path}.path`);
}

function assertWireType(value: unknown, path: string): asserts value is WireType {
  const candidate = record(value, path);
  switch (candidate.kind) {
    case "json":
    case "number":
      shape(value, path, ["kind"]);
      return;
    case "literal": {
      const data = shape(value, path, ["kind", "value"]);
      if (
        data.value !== null &&
        typeof data.value !== "string" &&
        typeof data.value !== "number" &&
        typeof data.value !== "boolean"
      ) {
        fail(`${path}.value`, "expected a JSON scalar");
      }
      return;
    }
    case "reference": {
      const data = shape(value, path, ["kind", "allOf", "sites"]);
      for (const [index, origin] of array(data.allOf, `${path}.allOf`).entries()) {
        assertWireOrigin(origin, `${path}.allOf[${index}]`);
      }
      strings(data.sites, `${path}.sites`);
      return;
    }
    case "object": {
      const data = shape(value, path, ["kind", "fields"]);
      for (const [index, field] of array(data.fields, `${path}.fields`).entries()) {
        const fieldPath = `${path}.fields[${index}]`;
        const fieldData = shape(field, fieldPath, ["key", "type"], ["optional"]);
        nonemptyString(fieldData.key, `${fieldPath}.key`);
        assertWireType(fieldData.type, `${fieldPath}.type`);
        if (fieldData.optional !== undefined) boolean(fieldData.optional, `${fieldPath}.optional`);
      }
      return;
    }
    case "array": {
      const data = shape(value, path, ["kind", "of"]);
      assertWireType(data.of, `${path}.of`);
      return;
    }
    case "union": {
      const data = shape(value, path, ["kind", "of"]);
      for (const [index, member] of array(data.of, `${path}.of`).entries()) {
        assertWireType(member, `${path}.of[${index}]`);
      }
      return;
    }
    default:
      fail(`${path}.kind`, "expected a recognized wire type");
  }
}

function assertWire(value: unknown, path: string): void {
  const data = shape(value, path, ["endpoints", "appWide"]);
  strings(data.appWide, `${path}.appWide`);
  for (const [index, endpoint] of array(data.endpoints, `${path}.endpoints`).entries()) {
    const endpointPath = `${path}.endpoints[${index}]`;
    const endpointData = shape(
      endpoint,
      endpointPath,
      ["path", "input", "output", "errors", "openError"],
      ["inputAdmissionError"],
    );
    nonemptyString(endpointData.path, `${endpointPath}.path`);
    assertWireType(endpointData.input, `${endpointPath}.input`);
    assertWireType(endpointData.output, `${endpointPath}.output`);
    strings(endpointData.errors, `${endpointPath}.errors`);
    boolean(endpointData.openError, `${endpointPath}.openError`);
    if (endpointData.inputAdmissionError !== undefined) {
      boolean(endpointData.inputAdmissionError, `${endpointPath}.inputAdmissionError`);
    }
  }
}

function assertDiagnostic(value: unknown, path: string): asserts value is ApplicationDiagnostic {
  const data = shape(value, path, ["severity", "code", "definition", "message"], ["endpoint"]);
  literal(data.severity, `${path}.severity`, DIAGNOSTIC_SEVERITIES);
  literal(data.code, `${path}.code`, DIAGNOSTIC_CODES);
  string(data.message, `${path}.message`);
  const definition = shape(data.definition, `${path}.definition`, ["kind", "name"]);
  literal(definition.kind, `${path}.definition.kind`, [
    "application",
    "endpoint",
    "reaction",
    "view",
    "former",
  ] as const);
  nonemptyString(definition.name, `${path}.definition.name`);
  if (data.endpoint !== undefined) {
    const endpoint = shape(data.endpoint, `${path}.endpoint`, ["name", "path"]);
    nonemptyString(endpoint.name, `${path}.endpoint.name`);
    nonemptyString(endpoint.path, `${path}.endpoint.path`);
  }
}

function uniqueFieldIndexes(value: unknown, path: string, field: string): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const [index, item] of array(value, path).entries()) {
    const itemPath = `${path}[${index}]`;
    const name = record(item, itemPath)[field];
    nonemptyString(name, `${itemPath}.${field}`);
    const prior = indexes.get(name);
    if (prior !== undefined) {
      fail(`${itemPath}.${field}`, `duplicates ${path}[${prior}].${field}`);
    }
    indexes.set(name, index);
  }
  return indexes;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function assertComputationReferences(
  application: AppIR,
  names: Pick<ReadonlySet<string>, "has">,
): void {
  const operations = (values: readonly (WhereOpIR | ViewOpIR)[], path: string): void => {
    for (const [index, operation] of values.entries()) {
      if (
        (operation.op === "holds" || operation.op === "compute") &&
        !names.has(operation.computation)
      ) {
        fail(`${path}[${index}].computation`, "computation is absent from $.computations");
      }
    }
  };
  const formerNode = (node: FormerNodeIR, path: string): void => {
    if (node.node === "record") {
      operations(node.where ?? [], `${path}.where`);
      for (const [name, entry] of Object.entries(node.entries)) {
        formerNode(entry, propertyPath(`${path}.entries`, name));
      }
      return;
    }
    if (node.node === "each") {
      operations(node.where ?? [], `${path}.where`);
      formerNode(node.as, `${path}.as`);
      return;
    }
    if (node.node === "count" || node.node === "first" || node.node === "distinct") {
      operations(node.where ?? [], `${path}.where`);
    }
  };

  for (const [index, reaction] of application.reactions.entries()) {
    operations(reaction.where, `$.application.reactions[${index}].where`);
  }
  for (const [viewIndex, view] of application.views.entries()) {
    for (const [alternativeIndex, alternative] of view.alternatives.entries()) {
      operations(
        alternative,
        `$.application.views[${viewIndex}].alternatives[${alternativeIndex}]`,
      );
    }
  }
  for (const [index, former] of application.formers.entries()) {
    formerNode(former.body, `$.application.formers[${index}].body`);
  }
  for (const [index, unlowered] of application.unlowered.entries()) {
    operations(unlowered.known.where, `$.application.unlowered[${index}].known.where`);
  }
}

function assertDesignLocation(value: unknown, path: string, sourceIds: ReadonlySet<string>): void {
  const data = shape(value, path, ["source", "line", "column"]);
  nonemptyString(data.source, `${path}.source`);
  if (!sourceIds.has(data.source))
    fail(`${path}.source`, "does not name a registered design source");
  integer(data.line, `${path}.line`, 1);
  integer(data.column, `${path}.column`, 1);
}

function assertTypeBindingTarget(value: unknown, path: string): void {
  const candidate = record(value, path);
  if (candidate.kind === "concrete") {
    const data = shape(value, path, ["kind", "name"]);
    designIdentifier(data.name, `${path}.name`);
    return;
  }
  if (candidate.kind === "qualified") {
    const data = shape(value, path, ["kind", "instance", "type"]);
    designIdentifier(data.instance, `${path}.instance`);
    designIdentifier(data.type, `${path}.type`);
    return;
  }
  fail(`${path}.kind`, 'expected "concrete" or "qualified"');
}

function assertDesign(value: unknown, path: string): void {
  const data = shape(
    value,
    path,
    ["version", "checked", "sources", "declarations", "concepts", "computations"],
    ["types"],
  );
  if (data.version !== 1) fail(`${path}.version`, "expected 1");
  boolean(data.checked, `${path}.checked`);
  const sourceIds = new Set<string>();
  for (const [index, source] of array(data.sources, `${path}.sources`).entries()) {
    const sourcePath = `${path}.sources[${index}]`;
    const item = shape(
      source,
      sourcePath,
      ["id", "kind", "path", "digest"],
      ["title", "definition", "line"],
    );
    nonemptyString(item.id, `${sourcePath}.id`);
    if (sourceIds.has(item.id)) fail(`${sourcePath}.id`, "duplicates an earlier source id");
    sourceIds.add(item.id);
    literal(item.kind, `${sourcePath}.kind`, ["document", "concept"] as const);
    nonemptyString(item.path, `${sourcePath}.path`);
    if (
      (item.path as string).startsWith("/") ||
      /^[A-Za-z]:/.test(item.path as string) ||
      /[\\?#]/.test(item.path as string)
    )
      fail(`${sourcePath}.path`, "expected a host-independent relative POSIX path");
    if (!/^sha256-[0-9a-f]{64}$/.test(item.digest as string))
      fail(`${sourcePath}.digest`, "expected a normalized full-document SHA-256 digest");
    if (item.title !== undefined) nonemptyString(item.title, `${sourcePath}.title`);
    if (item.definition !== undefined) nonemptyString(item.definition, `${sourcePath}.definition`);
    if (item.line !== undefined) integer(item.line, `${sourcePath}.line`, 1);
  }
  for (const [index, declaration] of array(data.declarations, `${path}.declarations`).entries()) {
    const declarationPath = `${path}.declarations[${index}]`;
    const item = shape(
      declaration,
      declarationPath,
      ["kind", "identity", "runtimeNames", "coverage"],
      ["source"],
    );
    assertAuthoredIdentity(
      {
        kind: item.kind,
        identity: item.identity,
        ...(item.source === undefined ? {} : { source: item.source }),
      },
      declarationPath,
    );
    uniqueNonemptyStrings(item.runtimeNames, `${declarationPath}.runtimeNames`);
    for (const [locationIndex, at] of array(item.coverage, `${declarationPath}.coverage`).entries())
      assertDesignLocation(at, `${declarationPath}.coverage[${locationIndex}]`, sourceIds);
  }
  for (const [index, concept] of array(data.concepts, `${path}.concepts`).entries()) {
    const conceptPath = `${path}.concepts[${index}]`;
    const item = shape(
      concept,
      conceptPath,
      ["definition", "specification", "ownedTypes", "instances"],
      ["source"],
    );
    nonemptyString(item.definition, `${conceptPath}.definition`);
    if (item.source !== undefined && !sourceIds.has(item.source as string))
      fail(`${conceptPath}.source`, "does not name a concept source");
    assertSpecification(item.specification, `${conceptPath}.specification`);
    uniqueNonemptyStrings(item.ownedTypes, `${conceptPath}.ownedTypes`);
    for (const [ownedIndex, name] of item.ownedTypes.entries()) {
      designIdentifier(name, `${conceptPath}.ownedTypes[${ownedIndex}]`);
      if (ownedIndex > 0 && ordinal(item.ownedTypes[ownedIndex - 1], name) >= 0) {
        fail(`${conceptPath}.ownedTypes[${ownedIndex}]`, "must be in canonical ordinal order");
      }
    }
    const specification = record(item.specification, `${conceptPath}.specification`);
    if (specification.definitionName !== item.definition)
      fail(`${conceptPath}.definition`, "does not match specification.definitionName");
    for (const [instanceIndex, instance] of array(
      item.instances,
      `${conceptPath}.instances`,
    ).entries()) {
      const instancePath = `${conceptPath}.instances[${instanceIndex}]`;
      const selected = shape(instance, instancePath, ["name", "declaration", "bindings"]);
      designIdentifier(selected.name, `${instancePath}.name`);
      assertDesignLocation(selected.declaration, `${instancePath}.declaration`, sourceIds);
      for (const [bindingIndex, binding] of array(
        selected.bindings,
        `${instancePath}.bindings`,
      ).entries()) {
        const bindingPath = `${instancePath}.bindings[${bindingIndex}]`;
        const bound = shape(binding, bindingPath, ["external", "target", "location"]);
        designIdentifier(bound.external, `${bindingPath}.external`);
        assertTypeBindingTarget(bound.target, `${bindingPath}.target`);
        assertDesignLocation(bound.location, `${bindingPath}.location`, sourceIds);
      }
      uniqueFieldIndexes(selected.bindings, `${instancePath}.bindings`, "external");
    }
    uniqueFieldIndexes(item.instances, `${conceptPath}.instances`, "name");
  }
  if (data.types !== undefined) {
    const types = shape(data.types, `${path}.types`, ["concreteTypes"]);
    for (const [index, concrete] of array(
      types.concreteTypes,
      `${path}.types.concreteTypes`,
    ).entries()) {
      const concretePath = `${path}.types.concreteTypes[${index}]`;
      const item = shape(concrete, concretePath, ["name", "location"]);
      designIdentifier(item.name, `${concretePath}.name`);
      assertDesignLocation(item.location, `${concretePath}.location`, sourceIds);
    }
    uniqueFieldIndexes(types.concreteTypes, `${path}.types.concreteTypes`, "name");
  }
  for (const [index, computation] of array(data.computations, `${path}.computations`).entries()) {
    const computationPath = `${path}.computations[${index}]`;
    const item = shape(
      computation,
      computationPath,
      ["name", "inputs", "result", "location", "inputValidation"],
      ["runtimeInputs"],
    );
    designIdentifier(item.name, `${computationPath}.name`);
    for (const [inputIndex, input] of array(item.inputs, `${computationPath}.inputs`).entries()) {
      const inputPath = `${computationPath}.inputs[${inputIndex}]`;
      const field = shape(input, inputPath, ["name", "optional", "type"]);
      designIdentifier(field.name, `${inputPath}.name`);
      boolean(field.optional, `${inputPath}.optional`);
      nonemptyString(field.type, `${inputPath}.type`);
    }
    uniqueFieldIndexes(item.inputs, `${computationPath}.inputs`, "name");
    nonemptyString(item.result, `${computationPath}.result`);
    assertDesignLocation(item.location, `${computationPath}.location`, sourceIds);
    literal(item.inputValidation, `${computationPath}.inputValidation`, [
      "validated",
      "not-claimed",
    ] as const);
    if (item.runtimeInputs !== undefined)
      uniqueNonemptyStrings(item.runtimeInputs, `${computationPath}.runtimeInputs`);
  }
  uniqueFieldIndexes(data.computations, `${path}.computations`, "name");
  if (
    data.checked === true &&
    array(data.declarations, `${path}.declarations`).some(
      (item) => array(record(item, path).coverage, path).length === 0,
    )
  )
    fail(`${path}.declarations`, "checked declarations require authored coverage");
  if (
    data.checked === false &&
    (array(data.sources, `${path}.sources`).length > 0 ||
      array(data.declarations, `${path}.declarations`).length > 0 ||
      array(data.concepts, `${path}.concepts`).length > 0 ||
      array(data.computations, `${path}.computations`).length > 0 ||
      data.types !== undefined)
  )
    fail(path, "unchecked design blocks must not contain authored-design claims");
}

function assertInventorySpecificationAgreement(concept: DataRecord, path: string): void {
  if (concept.specification === undefined) return;
  const specification = record(concept.specification, `${path}.specification`);
  for (const field of ["purpose", "principle"] as const) {
    if (concept[field] !== specification[field])
      fail(`${path}.${field}`, `does not match ${path}.specification.${field}`);
  }

  for (const [kind, inventoryValue, specificationValue] of [
    ["actions", concept.actions, specification.actions],
    ["queries", concept.queries, specification.queries],
  ] as const) {
    const inventoryPath = `${path}.${kind}`;
    const specificationPath = `${path}.specification.${kind}`;
    const inventory = uniqueFieldIndexes(inventoryValue, inventoryPath, "name");
    const specified = uniqueFieldIndexes(specificationValue, specificationPath, "name");
    for (const [name, specificationIndex] of specified) {
      const inventoryIndex = inventory.get(name);
      if (inventoryIndex === undefined)
        fail(inventoryPath, `omits specified member ${JSON.stringify(name)}`);
      const item = record(
        array(inventoryValue, inventoryPath)[inventoryIndex],
        `${inventoryPath}[${inventoryIndex}]`,
      );
      const declaration = record(
        array(specificationValue, specificationPath)[specificationIndex],
        `${specificationPath}[${specificationIndex}]`,
      );
      if (item.roles !== undefined) {
        const expectedRoles = [...(declaration.inputs as string[])].sort(ordinal);
        if (!sameCanonicalValue(item.roles, expectedRoles))
          fail(`${inventoryPath}[${inventoryIndex}].roles`, "does not match specification inputs");
      }
      if (kind === "actions") {
        const expectedRefusals = array(
          declaration.refusals,
          `${specificationPath}[${specificationIndex}].refusals`,
        )
          .map((refusal) => record(refusal, specificationPath).code as string)
          .sort(ordinal);
        const actualRefusals = item.refusals ?? [];
        if (!sameCanonicalValue(actualRefusals, expectedRefusals))
          fail(
            `${inventoryPath}[${inventoryIndex}].refusals`,
            "does not match specification refusals",
          );
      } else if (item.returns !== declaration.promise) {
        fail(`${inventoryPath}[${inventoryIndex}].returns`, "does not match specification promise");
      }
    }
    for (const [name, inventoryIndex] of inventory) {
      if (!specified.has(name))
        fail(`${inventoryPath}[${inventoryIndex}].name`, "has no matching specification member");
    }
  }
}

function assertManifestCrossFields(data: DataRecord): void {
  const conceptIndexes = uniqueFieldIndexes(data.concepts, "$.concepts", "name");
  if (!conceptIndexes.has("RequestBoundary")) {
    fail("$.concepts", 'expected the assembled "RequestBoundary" concept inventory');
  }
  for (const [index, concept] of array(data.concepts, "$.concepts").entries()) {
    const conceptData = record(concept, `$.concepts[${index}]`);
    uniqueFieldIndexes(conceptData.actions, `$.concepts[${index}].actions`, "name");
    uniqueFieldIndexes(conceptData.queries, `$.concepts[${index}].queries`, "name");
    assertInventorySpecificationAgreement(conceptData, `$.concepts[${index}]`);
  }

  const implementationIndexes = uniqueFieldIndexes(
    data.conceptImplementations,
    "$.conceptImplementations",
    "concept",
  );
  for (const concept of conceptIndexes.keys()) {
    if (!implementationIndexes.has(concept)) {
      fail(
        "$.conceptImplementations",
        `missing the implementation selected for ${JSON.stringify(concept)}`,
      );
    }
  }
  for (const [concept, index] of implementationIndexes) {
    if (!conceptIndexes.has(concept)) {
      fail(`$.conceptImplementations[${index}].concept`, "has no matching concept inventory");
    }
    const implementation = record(
      array(data.conceptImplementations, "$.conceptImplementations")[index],
      `$.conceptImplementations[${index}]`,
    );
    const canonical = record(
      implementation.canonical,
      `$.conceptImplementations[${index}].canonical`,
    );
    const selected = record(implementation.selected, `$.conceptImplementations[${index}].selected`);
    if (concept === "RequestBoundary") {
      if (canonical.owner !== "core") {
        fail(`$.conceptImplementations[${index}].canonical.owner`, 'expected "core"');
      }
      if (selected.via !== "core") {
        fail(`$.conceptImplementations[${index}].selected.via`, 'expected "core"');
      }
    } else {
      if (canonical.owner !== "application") {
        fail(`$.conceptImplementations[${index}].canonical.owner`, 'expected "application"');
      }
      if (selected.via === "core") {
        fail(`$.conceptImplementations[${index}].selected.via`, "core selection is boundary-owned");
      }
    }
  }

  const computationIndexes = uniqueFieldIndexes(data.computations, "$.computations", "name");
  const standardNames = new Set(["among", "ge", "gt", "le", "lt"]);
  for (const [index, computation] of array(data.computations, "$.computations").entries()) {
    const computationData = record(computation, `$.computations[${index}]`);
    if (
      computationData.source === "standard" &&
      !standardNames.has(computationData.name as string)
    ) {
      fail(`$.computations[${index}].name`, "is not a standard computation");
    }
  }
  for (const name of standardNames) {
    const index = computationIndexes.get(name);
    if (index === undefined)
      fail("$.computations", `missing standard computation ${JSON.stringify(name)}`);
    const computation = record(
      array(data.computations, "$.computations")[index],
      `$.computations[${index}]`,
    );
    if (computation.source !== "standard") {
      fail(`$.computations[${index}].source`, `expected "standard" for ${JSON.stringify(name)}`);
    }
  }
  assertComputationReferences(data.application as unknown as AppIR, computationIndexes);

  const design = record(data.design, "$.design");
  if (design.checked === true) {
    const application = data.application as unknown as AppIR;
    const runtimeByAuthored = new Map<string, string[]>();
    for (const [kind, values] of [
      ["reaction", [...application.reactions, ...application.unlowered]],
      ["view", application.views],
      ["former", application.formers],
    ] as const) {
      for (const runtime of values) {
        if (runtime.authored === undefined) continue;
        const key = `${kind}\0${runtime.authored.identity}`;
        const names = runtimeByAuthored.get(key) ?? [];
        names.push(runtime.name);
        runtimeByAuthored.set(key, names);
      }
    }
    const declared = new Set<string>();
    for (const [index, declaration] of array(
      design.declarations,
      "$.design.declarations",
    ).entries()) {
      const item = record(declaration, `$.design.declarations[${index}]`);
      const key = `${item.kind as string}\0${item.identity as string}`;
      if (declared.has(key))
        fail(`$.design.declarations[${index}].identity`, "duplicates an authored declaration");
      declared.add(key);
      const expected = [...(runtimeByAuthored.get(key) ?? [])].sort(ordinal);
      if (!sameCanonicalValue(item.runtimeNames, expected))
        fail(
          `$.design.declarations[${index}].runtimeNames`,
          "does not match authored-to-lowered runtime provenance",
        );
    }
    for (const key of runtimeByAuthored.keys()) {
      if (!declared.has(key)) fail("$.design.declarations", "omits authored runtime provenance");
    }

    const selectedConcepts = new Set(
      [...conceptIndexes.keys()].filter((name) => name !== "RequestBoundary"),
    );
    const designInstances = new Set<string>();
    const designInstanceRecords = new Map<
      string,
      { item: DataRecord; path: string; externalTypes: Set<string>; ownedTypes: Set<string> }
    >();
    const definitions = new Set<string>();
    for (const [index, concept] of array(design.concepts, "$.design.concepts").entries()) {
      const item = record(concept, `$.design.concepts[${index}]`);
      if (definitions.has(item.definition as string))
        fail(`$.design.concepts[${index}].definition`, "duplicates a reusable concept definition");
      definitions.add(item.definition as string);
      if (item.source === undefined)
        fail(
          `$.design.concepts[${index}].source`,
          "checked concept definitions require traced Markdown provenance",
        );
      const authoritativeOwnedTypes = specificationOwnedTypeNames(
        item.specification as ConceptSpecificationIR,
      );
      if (!sameCanonicalValue(item.ownedTypes, authoritativeOwnedTypes)) {
        fail(
          `$.design.concepts[${index}].ownedTypes`,
          "does not equal the inventory independently derived from specification State and operation type evidence",
        );
      }
      for (const [instanceIndex, instance] of array(
        item.instances,
        `$.design.concepts[${index}].instances`,
      ).entries()) {
        const instanceItem = record(
          instance,
          `$.design.concepts[${index}].instances[${instanceIndex}]`,
        );
        const name = instanceItem.name as string;
        if (!selectedConcepts.has(name))
          fail(
            `$.design.concepts[${index}].instances[${instanceIndex}].name`,
            "is not a selected concept instance",
          );
        if (designInstances.has(name))
          fail(
            `$.design.concepts[${index}].instances[${instanceIndex}].name`,
            "appears under more than one definition",
          );
        designInstances.add(name);
        const specification = record(
          item.specification,
          `$.design.concepts[${index}].specification`,
        );
        const externalTypes = new Set(
          array(
            specification.externalTypes,
            `$.design.concepts[${index}].specification.externalTypes`,
          ).map(
            (external, externalIndex) =>
              record(
                external,
                `$.design.concepts[${index}].specification.externalTypes[${externalIndex}]`,
              ).name as string,
          ),
        );
        designInstanceRecords.set(name, {
          item: instanceItem,
          path: `$.design.concepts[${index}].instances[${instanceIndex}]`,
          externalTypes,
          ownedTypes: new Set(authoritativeOwnedTypes),
        });
        const inventoryIndex = conceptIndexes.get(name)!;
        const inventory = record(
          array(data.concepts, "$.concepts")[inventoryIndex],
          `$.concepts[${inventoryIndex}]`,
        );
        if (!sameCanonicalValue(inventory.specification, item.specification))
          fail(
            `$.design.concepts[${index}].specification`,
            "does not match the selected runtime inventory specification",
          );
      }
    }
    for (const name of selectedConcepts)
      if (!designInstances.has(name))
        fail("$.design.concepts", `omits selected concept instance ${JSON.stringify(name)}`);

    const concreteTypes = new Set<string>();
    if (design.types !== undefined) {
      const types = record(design.types, "$.design.types");
      for (const [index, concrete] of array(
        types.concreteTypes,
        "$.design.types.concreteTypes",
      ).entries()) {
        concreteTypes.add(
          record(concrete, `$.design.types.concreteTypes[${index}]`).name as string,
        );
      }
    }
    for (const [name, instance] of designInstanceRecords) {
      const bindingIndexes = uniqueFieldIndexes(
        instance.item.bindings,
        `${instance.path}.bindings`,
        "external",
      );
      for (const external of instance.externalTypes) {
        if (!bindingIndexes.has(external))
          fail(
            `${instance.path}.bindings`,
            `omits external parameter ${JSON.stringify(external)} for ${JSON.stringify(name)}`,
          );
      }
      for (const [external, bindingIndex] of bindingIndexes) {
        if (!instance.externalTypes.has(external))
          fail(
            `${instance.path}.bindings[${bindingIndex}].external`,
            "is not declared by the selected definition",
          );
        const binding = record(
          array(instance.item.bindings, `${instance.path}.bindings`)[bindingIndex],
          `${instance.path}.bindings[${bindingIndex}]`,
        );
        const target = record(binding.target, `${instance.path}.bindings[${bindingIndex}].target`);
        if (target.kind === "concrete") {
          if (!concreteTypes.has(target.name as string))
            fail(
              `${instance.path}.bindings[${bindingIndex}].target.name`,
              "does not name a concrete application type",
            );
          continue;
        }
        const selectedTarget = designInstanceRecords.get(target.instance as string);
        if (selectedTarget === undefined)
          fail(
            `${instance.path}.bindings[${bindingIndex}].target.instance`,
            "does not name a selected authored instance",
          );
        if (selectedTarget.externalTypes.has(target.type as string))
          fail(
            `${instance.path}.bindings[${bindingIndex}].target.type`,
            "names an external parameter; bindings must terminate directly",
          );
        if (!selectedTarget.ownedTypes.has(target.type as string))
          fail(
            `${instance.path}.bindings[${bindingIndex}].target.type`,
            "does not name an SSF-owned type of the selected definition",
          );
      }
    }

    const expectedComputations = new Set(
      array(data.computations, "$.computations")
        .map((item) => record(item, "$.computations[]"))
        .filter(({ source }) => source === "vocabulary")
        .map(({ name }) => name as string),
    );
    const authoredComputations = uniqueFieldIndexes(
      design.computations,
      "$.design.computations",
      "name",
    );
    for (const name of expectedComputations)
      if (!authoredComputations.has(name))
        fail("$.design.computations", `omits executable computation ${JSON.stringify(name)}`);
    for (const [name, index] of authoredComputations) {
      if (!expectedComputations.has(name))
        fail(`$.design.computations[${index}].name`, "has no executable vocabulary computation");
      const item = record(
        array(design.computations, "$.design.computations")[index],
        `$.design.computations[${index}]`,
      );
      if (item.inputValidation !== "validated")
        fail(
          `$.design.computations[${index}].inputValidation`,
          "checked generated manifests require authoritative input validation",
        );
    }
  }

  uniqueFieldIndexes(data.endpoints, "$.endpoints", "name");
  const endpointPaths = new Set<string>();
  const contracts = record(data.inputContracts, "$.inputContracts");
  for (const [index, endpoint] of array(data.endpoints, "$.endpoints").entries()) {
    const endpointData = record(endpoint, `$.endpoints[${index}]`);
    const path = endpointData.path as string;
    endpointPaths.add(path);
    if (!Object.hasOwn(contracts, path)) {
      fail(`$.endpoints[${index}].path`, "has no matching input contract");
    }
    if (!sameCanonicalValue(endpointData.input, contracts[path])) {
      fail(
        `$.endpoints[${index}].input`,
        `does not match $.inputContracts[${JSON.stringify(path)}]`,
      );
    }
  }
  for (const path of Object.keys(contracts)) {
    if (path === "") fail('$.inputContracts[""]', "expected a non-empty endpoint path");
    if (!endpointPaths.has(path)) {
      fail(propertyPath("$.inputContracts", path), "has no matching endpoint declaration");
    }
  }

  const wire = record(data.wire, "$.wire");
  const wirePathIndexes = uniqueFieldIndexes(wire.endpoints, "$.wire.endpoints", "path");
  for (const path of endpointPaths) {
    if (!wirePathIndexes.has(path)) {
      fail("$.wire.endpoints", `missing the logical wire for ${JSON.stringify(path)}`);
    }
  }
  for (const [path, index] of wirePathIndexes) {
    if (!endpointPaths.has(path)) {
      fail(`$.wire.endpoints[${index}].path`, "has no matching endpoint declaration");
    }
  }
}

function manifestBodyDigest(data: DataRecord): string {
  const body: DataRecord = {};
  for (const [key, value] of Object.entries(data)) {
    if (key !== "digest") setOwn(body, key, value);
  }
  return canonicalDigest(body);
}

function assertManifestStructure(value: unknown, crossFields = true): DataRecord {
  assertJsonValue(value, "$", new WeakSet());
  const candidate = record(value, "$");
  if (Object.hasOwn(candidate, "version") && candidate.version !== 1) {
    fail("$.version", "expected 1");
  }
  const data = shape(value, "$", [
    "format",
    "version",
    "generator",
    "digest",
    "application",
    "concepts",
    "computations",
    "conceptImplementations",
    "endpoints",
    "inputContracts",
    "wire",
    "diagnostics",
    "design",
  ]);
  if (data.format !== "sync-engine.application-manifest") {
    fail("$.format", 'expected "sync-engine.application-manifest"');
  }
  if (data.version !== 1) fail("$.version", "expected 1");
  const generator = shape(data.generator, "$.generator", ["name", "version"]);
  if (generator.name !== PACKAGE_NAME)
    fail("$.generator.name", `expected ${JSON.stringify(PACKAGE_NAME)}`);
  if (!isSemVer(generator.version)) fail("$.generator.version", "expected a semantic version");
  nonemptyString(data.digest, "$.digest");
  assertApplication(data.application, "$.application");
  for (const [index, concept] of array(data.concepts, "$.concepts").entries()) {
    assertConcept(concept, `$.concepts[${index}]`);
  }
  for (const [index, computation] of array(data.computations, "$.computations").entries()) {
    assertComputation(computation, `$.computations[${index}]`);
  }
  for (const [index, implementation] of array(
    data.conceptImplementations,
    "$.conceptImplementations",
  ).entries()) {
    assertConceptImplementation(implementation, `$.conceptImplementations[${index}]`);
  }
  for (const [index, endpoint] of array(data.endpoints, "$.endpoints").entries()) {
    assertManifestEndpoint(endpoint, `$.endpoints[${index}]`);
  }
  for (const [key, contract] of Object.entries(record(data.inputContracts, "$.inputContracts"))) {
    assertInputContract(contract, propertyPath("$.inputContracts", key));
  }
  assertWire(data.wire, "$.wire");
  for (const [index, diagnostic] of array(data.diagnostics, "$.diagnostics").entries()) {
    assertDiagnostic(diagnostic, `$.diagnostics[${index}]`);
  }
  assertDesign(data.design, "$.design");
  if (crossFields) assertManifestCrossFields(data);
  return data;
}

/** Recompute the canonical digest over every manifest field except `digest`. */
export function applicationManifestDigest(manifest: ApplicationManifestV1): string {
  return manifestBodyDigest(assertManifestStructure(manifest, false));
}

/** Validate untrusted data as one complete canonical version-1 application manifest. */
export function validateApplicationManifest(
  value: unknown,
): asserts value is ApplicationManifestV1 {
  const data = assertManifestStructure(value);
  const expected = manifestBodyDigest(data);
  if (data.digest !== expected) {
    fail(
      "$.digest",
      `expected canonical digest ${JSON.stringify(expected)}, received ${JSON.stringify(data.digest)}`,
    );
  }
}

/** Parse and validate canonical version-1 application-manifest JSON without executing code. */
export function parseApplicationManifest(source: string): ApplicationManifestV1 {
  if (typeof source !== "string") fail("$", "expected manifest JSON text");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(
      `Invalid application manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  validateApplicationManifest(value);
  return canonicalValue(value) as unknown as ApplicationManifestV1;
}
