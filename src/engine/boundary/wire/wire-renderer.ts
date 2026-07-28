/** Render a hand-built or derived wire contract IR as a TypeScript module. */

import type { WireContractsIR } from "./wire-contracts.ts";
import { JSON_TYPE } from "./wire-types.ts";
import type { WireOrigin, WireType } from "./wire-types.ts";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

export interface WireRenderOptions {
  moduleName?: string;
  vocabulary?: { from: string; export: string };
  strictLeaves?: boolean;
  /** Name of this contract's application-wide error union. */
  appWideErrorName?: string;
  /** Omit shared imports and helpers when appending another contract. */
  preamble?: boolean;
}

function unresolvedLeaves(type: WireType, site: string, into: string[]): void {
  switch (type.kind) {
    case "json":
      into.push(site);
      return;
    case "object":
      for (const field of type.fields) {
        unresolvedLeaves(field.type, `${site}.${field.key}`, into);
      }
      return;
    case "array":
      unresolvedLeaves(type.of, `${site}[]`, into);
      return;
    case "union":
      for (const member of type.of) unresolvedLeaves(member, site, into);
      return;
    case "reference":
    case "number":
    case "literal":
      return;
  }
}

function originType(origin: WireOrigin): string {
  switch (origin.source) {
    case "literal":
      return JSON.stringify(origin.value);
    case "number":
      return "number";
    case "action-input":
    case "query-input":
      return `AtPath<Parameters<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>[0], ${JSON.stringify(origin.path)}>`;
    case "action-output":
      return `AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>, ${JSON.stringify(origin.path)}>`;
    case "query-output":
      return `AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)[${JSON.stringify(origin.concept)}][${JSON.stringify(origin.member)}]>>>, ${JSON.stringify(origin.path)}>`;
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
  const anchored = options.vocabulary !== undefined;
  if (options.strictLeaves === true) {
    if (!anchored) {
      throw new Error("renderWireTypes: strictLeaves requires a vocabulary type anchor.");
    }
    const unresolved: string[] = [];
    for (const endpoint of wire.endpoints) {
      unresolvedLeaves(endpoint.input, `${endpoint.path}.input`, unresolved);
      unresolvedLeaves(endpoint.output, `${endpoint.path}.output`, unresolved);
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
      `// Generated wire contracts by ${PACKAGE_NAME}@${PACKAGE_VERSION} — do not edit.`,
      "// Regenerated from registered formers, action outcomes, and input contracts.",
      "",
    );
  }
  if (options.preamble !== false && options.vocabulary !== undefined) {
    lines.push(
      `import type { ${options.vocabulary.export} as ApplicationVocabulary } from ${JSON.stringify(options.vocabulary.from)};`,
      "",
      "type AtPath<T, P extends readonly string[]> = P extends readonly [infer H extends string, ...infer R extends string[]] ? H extends keyof T ? AtPath<T[H], R> : never : T;",
      "type QueryRow<T> = T extends readonly (infer Row)[] ? Row : T;",
      "type AllOf<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Rest] ? Head & AllOf<Rest> : unknown;",
      "type OneOf<T extends readonly unknown[]> = T[number];",
      "type Jsonify<T> = T extends Date ? string : T extends null | boolean | number | string ? T : T extends (...args: never[]) => unknown ? never : T extends readonly (infer Item)[] ? Jsonify<Item>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : never;",
      "",
    );
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
    lines.push(`  ${JSON.stringify(endpoint.path)}: {`);
    lines.push(`    input: ${printType(endpoint.input, "    ", anchored)};`);
    lines.push(`    output: ${printType(endpoint.output, "    ", anchored)};`);
    lines.push(`    error: { error: ${errorUnion} };`);
    lines.push("  };");
  }
  lines.push("};", "");
  return lines.join("\n");
}
