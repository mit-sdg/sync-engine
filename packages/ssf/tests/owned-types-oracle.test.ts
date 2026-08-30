import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ownedTypeNameSpellings, parseSimpleStateForm } from "../src/simple-state-form.ts";
import { pluralize } from "../src/vendor/plur.ts";
import { describe, expect, test } from "vite-plus/test";

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
const PRIMITIVES = new Set(["Date", "DateTime", "Flag", "Number", "String"]);

type Multiplicity = "element" | "sequence" | "set";

interface OracleOptions {
  readonly externalTypes?: readonly string[];
  readonly localTypes?: readonly { readonly name: string; readonly values?: readonly string[] }[];
  readonly evidenceTypeNames?: readonly string[];
}

function multiplicity(word: string): Multiplicity | undefined {
  if (word === "element" || word === "set") return word;
  return word === "seq" ? "sequence" : undefined;
}

function structuralDeclaration(line: string): readonly [string, Multiplicity] | undefined {
  if (/^[ \t]/.test(line)) return undefined;
  const words = line.trim().split(/\s+/);
  if (words[0] !== "a" && words[0] !== "an") return undefined;
  let index = 1;
  let declaredMultiplicity = multiplicity(words[index] ?? "");
  if (declaredMultiplicity !== undefined) {
    index += 1;
    if (words[index] === "of") index += 1;
  } else {
    declaredMultiplicity = multiplicity(words[index + 1] ?? "");
    if (declaredMultiplicity === undefined) return undefined;
  }
  const name = words[index];
  return name !== undefined && TYPE_NAME.test(name) ? [name, declaredMultiplicity] : undefined;
}

function stateFieldType(line: string): string | undefined {
  if (!/^[ \t]/.test(line)) return undefined;
  const original = line.trim().split(/\s+/);
  const first = original[0] === "a" || original[0] === "an" ? 1 : 0;
  const optional = original.indexOf("optional", first);
  const words = original.filter((_, index) => index >= first && index !== optional);
  let value = 0;
  if (words[0] !== "set" && words[0] !== "seq" && FIELD_NAME.test(words[0] ?? "")) value = 1;
  if (words[value] === "set" || words[value] === "seq") {
    value += 1;
    if (words[value] === "of") value += 1;
  }
  const candidate = words[value];
  return candidate !== undefined && TYPE_NAME.test(candidate) && value + 1 === words.length
    ? candidate
    : undefined;
}

/** Independent, test-only line scanner for valid SSF inventories. */
function oracleOwnedTypeNames(source: string, options: OracleOptions = {}): readonly string[] {
  const external = new Set(options.externalTypes ?? []);
  const lines = source.split(/\r?\n/);
  const declarations = new Map(
    lines
      .map(structuralDeclaration)
      .filter((item): item is readonly [string, Multiplicity] => item !== undefined)
      .filter(([name]) => !external.has(name) && !PRIMITIVES.has(name)),
  );
  const explicitAliases = lines.flatMap((line): Array<readonly [string, string]> => {
    const words = line.trim().split(/\s+/);
    return !/^[ \t]/.test(line) &&
      words.length === 4 &&
      words[0] === "alias" &&
      words[2] === "for" &&
      TYPE_NAME.test(words[1] ?? "") &&
      TYPE_NAME.test(words[3] ?? "")
      ? [[words[1]!, words[3]!]]
      : [];
  });
  const explicitNames = new Set(explicitAliases.map(([name]) => name));
  const owned = new Set(declarations.keys());
  for (const [name, target] of explicitAliases) {
    if (
      declarations.has(target) &&
      !declarations.has(name) &&
      !external.has(name) &&
      !PRIMITIVES.has(name)
    ) {
      owned.add(name);
    }
  }

  const evidence = new Set([
    ...lines.map(stateFieldType).filter((name): name is string => name !== undefined),
    ...(options.evidenceTypeNames ?? []),
  ]);
  const relation = [...evidence]
    .sort()
    .filter(
      (candidate) =>
        !declarations.has(candidate) &&
        !explicitNames.has(candidate) &&
        !external.has(candidate) &&
        !PRIMITIVES.has(candidate) &&
        TYPE_NAME.test(candidate),
    )
    .flatMap((candidate) =>
      [...declarations]
        .filter(
          ([owner, ownerMultiplicity]) =>
            ownerMultiplicity !== "element" &&
            (pluralize(owner) === candidate || pluralize(candidate) === owner),
        )
        .map(([owner]) => [candidate, owner] as const),
    );
  // The documented one-to-one rule keeps only isolated edges in the complete relation.
  for (const [candidate, owner] of relation) {
    if (
      relation.every(
        ([otherCandidate, otherOwner]) =>
          (otherCandidate === candidate && otherOwner === owner) ||
          (otherCandidate !== candidate && otherOwner !== owner),
      )
    ) {
      owned.add(candidate);
    }
  }
  return [...owned].sort();
}

function stateFence(markdown: string): string {
  const match = /```state\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  if (match?.[1] === undefined) throw new Error("fixture has no State fence");
  return match[1];
}

function externalTypes(markdown: string): string[] {
  const match = /```types\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  return [...(match?.[1] ?? "").matchAll(/^external ([A-Z][A-Za-z0-9_]*)$/gm)].map(
    (declaration) => declaration[1] ?? "",
  );
}

function localTypes(markdown: string): { name: string; values?: readonly string[] }[] {
  const match = /```types\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  const body = match?.[1] ?? "";
  return [
    ...[...body.matchAll(/^opaque ([A-Z][A-Za-z0-9_]*)$/gm)].map(([, name]) => ({ name: name! })),
    ...[...body.matchAll(/^([A-Z][A-Za-z0-9_]*) is (\S.*)$/gm)].map(([, name, rest]) => {
      const values = rest!.split(/\s+or\s+/);
      return values.length > 1 ? { name: name!, values } : { name: name! };
    }),
  ];
}

function memberTypeEvidence(markdown: string): string[] {
  return [...markdown.matchAll(/```(?:actions|queries)\r?\n([\s\S]*?)\r?\n```/g)].flatMap(
    ([, body]) =>
      (body ?? "")
        .split(/\r?\n/)
        .filter((line) => !/^\s/.test(line) && /^[a-z_][A-Za-z0-9_]*\s*\(/.test(line))
        .flatMap((line) => [...line.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)].map(([name]) => name)),
  );
}

function expectAgreement(label: string, source: string, options: OracleOptions = {}): void {
  const parsed = parseSimpleStateForm(source, options);
  // The oracle compares ownership. An undeclared name is by definition not owned, so its
  // diagnostic is orthogonal here and fixtures may leave alias candidates undeclared.
  expect(
    parsed.diagnostics.filter(
      ({ severity, code }) => severity === "error" && code !== "SSF_UNDECLARED_TYPE",
    ),
    label,
  ).toEqual([]);
  expect(ownedTypeNameSpellings(parsed.document.inventory), label).toEqual(
    oracleOwnedTypeNames(source, options),
  );
}

describe("independent owned-type inventory oracle", () => {
  test("derives structural, automatic, and explicit alias names", () => {
    expectAgreement(
      "focused",
      `a set of Mice with
  a parent Mouse
  a owner Person

alias Rodent for Mice

a Selected set of Mice

an element Settings`,
      { externalTypes: ["Person"] },
    );
    expect(
      ownedTypeNameSpellings(parseSimpleStateForm("a set of Mice").document.inventory),
    ).toEqual(["Mice"]);
  });

  test("applies one-to-one globally across mixed candidate and owner ambiguity", () => {
    const source = `a set of These with
  a singular This
  a shared Theses

a set of Thesis`;
    expect(oracleOwnedTypeNames(source)).toEqual(["These", "Thesis"]);
    expectAgreement("mixed ambiguity", source);
  });

  test("agrees for every catalog concept State and operation evidence", async () => {
    const entries = resolve(import.meta.dirname, "../../catalog/entries/concept");
    const concepts = (await readdir(entries, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
    for (const concept of concepts) {
      const path = resolve(entries, concept, "spec.md");
      const markdown = await readFile(path, "utf8");
      expectAgreement(path, stateFence(markdown), {
        externalTypes: externalTypes(markdown),
        localTypes: localTypes(markdown),
        evidenceTypeNames: memberTypeEvidence(markdown),
      });
    }
  });
});
