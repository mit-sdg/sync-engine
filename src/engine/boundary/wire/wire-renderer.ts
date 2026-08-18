/** Render a hand-built or derived wire contract IR as a TypeScript module. */

import type { WireContractsIR } from "./wire-contracts.ts";
import { JSON_TYPE, unresolvedWireLeaves } from "./wire-types.ts";
import type { WireOrigin, WireType } from "./wire-types.ts";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

export interface WireRenderOptions {
  moduleName?: string;
  /** Replace the default generated-file banner. */
  banner?: string;
  conceptSet?: { from: string; export: string };
  strictLeaves?: boolean;
  /** Name of this contract's application-wide error union. */
  appWideErrorName?: string;
  /** Omit shared imports and helpers when appending another contract. */
  preamble?: boolean;
  /** Additional contracts appended under this module's shared preamble. */
  sharedWires?: readonly WireContractsIR[];
}

const WIRE_HELPERS = {
  ApplicationConceptSet: "",
  AtPath:
    "type AtPath<T, P extends readonly string[]> = P extends readonly [infer H extends string, ...infer R extends string[]] ? H extends keyof T ? AtPath<T[H], R> : never : T;",
  QueryRow: "type QueryRow<T> = T extends readonly (infer Row)[] ? Row : T;",
  AllOf:
    "type AllOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest] ? Head & AllOf<Rest> : unknown;",
  OneOf: "type OneOf<T extends readonly unknown[]> = T[number];",
  Jsonify:
    "type Jsonify<T> = T extends Date ? string : T extends null | boolean | number | string ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer Item)[] ? Jsonify<Item>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : never;",
} as const;

type WireHelperName = keyof typeof WIRE_HELPERS;

export function wireHelperNames(wires: readonly WireContractsIR[]): ReadonlySet<WireHelperName> {
  const helpers = new Set<WireHelperName>();
  const visit = (type: WireType): void => {
    if (type.kind === "reference") {
      helpers.add("Jsonify");
      if (type.allOf.length !== 1) helpers.add("AllOf");
      if (type.allOf.some(({ source }) => source !== "literal" && source !== "number")) {
        helpers.add("ApplicationConceptSet");
        helpers.add("AtPath");
      }
      if (type.allOf.some(({ source }) => source === "query-output")) helpers.add("QueryRow");
    } else if (type.kind === "union") {
      if (type.of.filter(({ kind }) => kind === "reference").length > 1) helpers.add("OneOf");
      type.of.forEach(visit);
    } else if (type.kind === "object") {
      type.fields.forEach(({ type: field }) => visit(field));
    } else if (type.kind === "array") {
      visit(type.of);
    }
  };
  for (const { endpoints } of wires) {
    for (const { input, output } of endpoints) [input, output].forEach(visit);
  }
  return helpers;
}

function originType(origin: WireOrigin): string {
  switch (origin.source) {
    case "literal":
      return JSON.stringify(origin.value);
    case "number":
      return "number";
    case "action-input":
    case "query-input":
      return `AtPath<Parameters<(typeof ApplicationConceptSet.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>[0], ${JSON.stringify(origin.path)}>`;
    case "action-output":
      return `AtPath<Awaited<ReturnType<(typeof ApplicationConceptSet.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>, ${JSON.stringify(origin.path)}>`;
    case "query-output":
      return `AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationConceptSet.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>>, ${JSON.stringify(origin.path)}>`;
    case "computation-input":
      return `AtPath<Parameters<(typeof ApplicationConceptSet.computations)[${JSON.stringify(origin.computation)}]["fn"]>[0], ${JSON.stringify(origin.path)}>`;
    case "computation-output":
      return `AtPath<Awaited<ReturnType<(typeof ApplicationConceptSet.computations)[${JSON.stringify(origin.computation)}]["fn"]>>, ${JSON.stringify(origin.path)}>`;
  }
}

function referenceSource(type: Extract<WireType, { kind: "reference" }>): string {
  const sources = type.allOf.map(originType);
  return sources.length === 1 ? sources[0] : `AllOf<[${sources.join(", ")}]>`;
}

function printType(type: WireType, indent: string, anchored = false): string {
  switch (type.kind) {
    case "json":
      return "Json";
    case "reference":
      return anchored ? `Jsonify<${referenceSource(type)}>` : "Json";
    case "number":
      return "number";
    case "literal":
      return JSON.stringify(type.value);
    case "array": {
      const inner = printType(type.of, indent, anchored);
      return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
    }
    case "union": {
      if (type.of.length === 0) return "never";
      if (!anchored) {
        const withoutDuplicateJson = type.of.some((member) => member.kind === "reference")
          ? [JSON_TYPE, ...type.of.filter((member) => member.kind !== "reference")]
          : type.of;
        return withoutDuplicateJson.map((member) => printType(member, indent, false)).join(" | ");
      }
      const references = type.of.filter(
        (member): member is Extract<WireType, { kind: "reference" }> => member.kind === "reference",
      );
      const rendered = type.of
        .filter((member) => member.kind !== "reference")
        .map((member) => printType(member, indent, true));
      if (references.length === 1) rendered.unshift(`Jsonify<${referenceSource(references[0])}>`);
      if (references.length > 1) {
        rendered.unshift(`Jsonify<OneOf<[${references.map(referenceSource).join(", ")}]>>`);
      }
      return rendered.join(" | ");
    }
    case "object": {
      if (type.fields.length === 0) return "Record<string, never>";
      const deeper = indent + "  ";
      const lines = type.fields.map(
        (field) =>
          `${deeper}${JSON.stringify(field.key)}${field.optional === true ? "?" : ""}: ${printType(field.type, deeper, anchored)};`,
      );
      return `{\n${lines.join("\n")}\n${indent}}`;
    }
  }
}

function prefixKey(prefix: string): string {
  const literal = prefix.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
  return `[path: \`${literal}\${string}\`]`;
}

/** Emit the client-pluggable TypeScript contract module for one wire IR. */
export function renderWireTypes(wire: WireContractsIR, moduleName?: string): string;
export function renderWireTypes(wire: WireContractsIR, options?: WireRenderOptions): string;
export function renderWireTypes(
  wire: WireContractsIR,
  moduleNameOrOptions: string | WireRenderOptions = "WireContracts",
): string {
  const options =
    typeof moduleNameOrOptions === "string"
      ? { moduleName: moduleNameOrOptions }
      : moduleNameOrOptions;
  const moduleName = options.moduleName ?? "WireContracts";
  const appWideErrorName = options.appWideErrorName ?? "AppWideError";
  const anchored = options.conceptSet !== undefined;
  const helpers: ReadonlySet<WireHelperName> = anchored
    ? wireHelperNames([wire, ...(options.sharedWires ?? [])])
    : new Set();
  if (options.strictLeaves === true) {
    if (!anchored) {
      throw new Error("renderWireTypes: strictLeaves requires a concept-set type anchor.");
    }
    const unresolved: string[] = [];
    for (const endpoint of wire.endpoints) {
      unresolved.push(...unresolvedWireLeaves(endpoint.input, `${endpoint.path}.input`));
      unresolved.push(...unresolvedWireLeaves(endpoint.output, `${endpoint.path}.output`));
    }
    if (unresolved.length > 0) {
      throw new Error(
        `renderWireTypes: strictLeaves found unresolved Json at ${unresolved.join(", ")}.`,
      );
    }
  }
  const lines: string[] = [];
  if (options.preamble !== false) {
    lines.push(
      options.banner ??
        `// Generated wire contracts by ${PACKAGE_NAME}@${PACKAGE_VERSION} — do not edit.`,
      ...(options.banner === undefined
        ? ["// Regenerated from registered formers, action outcomes, and input contracts."]
        : []),
      "",
    );
  }
  if (options.preamble !== false && options.conceptSet !== undefined && helpers.size > 0) {
    if (helpers.has("ApplicationConceptSet")) {
      lines.push(
        `import type { ${options.conceptSet.export} as ApplicationConceptSet } from ${JSON.stringify(options.conceptSet.from)};`,
        "",
      );
    }
    for (const name of Object.keys(WIRE_HELPERS) as WireHelperName[]) {
      const definition = WIRE_HELPERS[name];
      if (helpers.has(name) && definition !== "") lines.push(definition);
    }
    lines.push("");
  }
  if (options.preamble !== false) {
    lines.push(
      "export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };",
      "",
    );
  }
  const appWide =
    wire.appWide.length === 0
      ? "never"
      : wire.appWide.map((code) => JSON.stringify(code)).join(" | ");
  lines.push(`export type ${appWideErrorName} = ${appWide};`, "");
  lines.push(`export type ${moduleName} = {`);
  for (const endpoint of wire.endpoints) {
    const own = endpoint.errors.map((code) => JSON.stringify(code));
    if (endpoint.openError) own.push("string");
    const errorUnion = [appWideErrorName, ...own].join(" | ");
    const key =
      endpoint.match === "prefix" ? prefixKey(endpoint.path) : JSON.stringify(endpoint.path);
    lines.push(`  ${key}: {`);
    lines.push(`    input: ${printType(endpoint.input, "    ", anchored)};`);
    lines.push(`    output: ${printType(endpoint.output, "    ", anchored)};`);
    lines.push(`    error: { error: ${errorUnion} };`);
    lines.push("  };");
  }
  lines.push("};", "");
  return lines.join("\n");
}
