import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ownedTypeNameSpellings, parseSimpleStateForm } from "../src/index.ts";
import { describe, expect, test } from "vite-plus/test";

const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const FIELD_NAME = /^[a-z][A-Za-z0-9_]*$/;
const PRIMITIVES = new Set(["Date", "DateTime", "Flag", "Number", "String"]);
const KNOWN_SINGULARS = new Set([
  "Access",
  "Address",
  "Alias",
  "Analysis",
  "Canvas",
  "Class",
  "Gas",
  "Lens",
  "News",
  "Process",
  "Series",
  "Species",
  "Status",
]);
const IRREGULAR_PLURALS = new Map<string, string>([
  ["Alias", "Aliases"],
  ["Analysis", "Analyses"],
  ["Canvas", "Canvases"],
  ["Child", "Children"],
  ["Foot", "Feet"],
  ["Gas", "Gases"],
  ["Goose", "Geese"],
  ["Index", "Indices"],
  ["Lens", "Lenses"],
  ["Man", "Men"],
  ["Matrix", "Matrices"],
  ["Mouse", "Mice"],
  ["Person", "People"],
  ["Status", "Statuses"],
  ["Tooth", "Teeth"],
  ["Woman", "Women"],
]);

type Multiplicity = "element" | "sequence" | "set";

interface StructuralDeclaration {
  readonly name: string;
  readonly multiplicity: Multiplicity;
}

interface OracleOptions {
  readonly externalTypes?: readonly string[];
  readonly evidenceTypeNames?: readonly string[];
}

function regularPlural(name: string): string {
  if (/[^AEIOU]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(?:ch|sh|ss|x|z|s)$/.test(name)) return `${name}es`;
  return `${name}s`;
}

function plural(name: string): string {
  return IRREGULAR_PLURALS.get(name) ?? regularPlural(name);
}

function inflectionPair(left: string, right: string): boolean {
  if (left === right) return true;
  if (KNOWN_SINGULARS.has(left)) return plural(left) === right;
  if (KNOWN_SINGULARS.has(right)) return plural(right) === left;
  return plural(left) === right || plural(right) === left;
}

function multiplicity(structural: string): Multiplicity | undefined {
  if (structural === "element" || structural === "set") return structural;
  if (structural === "seq") return "sequence";
  return undefined;
}

function structuralDeclaration(line: string): StructuralDeclaration | undefined {
  if (/^[ \t]/.test(line)) return undefined;
  const words = line.trim().split(/\s+/);
  let first = words[0] === "a" || words[0] === "an" ? 1 : 0;
  const topMultiplicity = multiplicity(words[first] ?? "");
  if (topMultiplicity !== undefined) {
    first += 1;
    if (words[first] === "of") first += 1;
    const name = words[first];
    const trailing = words.slice(first + 1);
    if (
      name !== undefined &&
      TYPE_NAME.test(name) &&
      (trailing.length === 0 || (trailing.length === 1 && trailing[0] === "with"))
    ) {
      return { name, multiplicity: topMultiplicity };
    }
    return undefined;
  }

  const name = words[first];
  const subsetMultiplicity = multiplicity(words[first + 1] ?? "");
  if (
    name === undefined ||
    !TYPE_NAME.test(name) ||
    subsetMultiplicity === undefined ||
    subsetMultiplicity === "sequence"
  ) {
    return undefined;
  }
  first += 2;
  if (words[first] === "of") first += 1;
  const parent = words[first];
  const trailing = words.slice(first + 1);
  return parent !== undefined &&
    TYPE_NAME.test(parent) &&
    (trailing.length === 0 || (trailing.length === 1 && trailing[0] === "with"))
    ? { name, multiplicity: subsetMultiplicity }
    : undefined;
}

function stateFieldType(line: string): string | undefined {
  if (!/^[ \t]/.test(line)) return undefined;
  const original = line.trim().split(/\s+/);
  const first = original[0] === "a" || original[0] === "an" ? 1 : 0;
  const optional = original.indexOf("optional", first);
  const words = original.filter((_, index) => index >= first && index !== optional);
  if (words.length === 0) return undefined;

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

/** Independent, test-only line scanner retained as an SSF inventory audit oracle. */
function oracleOwnedTypeNames(source: string, options: OracleOptions = {}): readonly string[] {
  const external = new Set(options.externalTypes ?? []);
  const lines = source.split(/\r?\n/);
  const declarations = lines
    .map(structuralDeclaration)
    .filter((item): item is StructuralDeclaration => item !== undefined)
    .filter(({ name }) => !external.has(name) && !PRIMITIVES.has(name));
  const declaredNames = new Set(declarations.map(({ name }) => name));
  const evidence = new Set([
    ...lines.map(stateFieldType).filter((name): name is string => name !== undefined),
    ...(options.evidenceTypeNames ?? []),
  ]);
  const accepted = new Set(declaredNames);
  for (const candidate of evidence) {
    if (
      declaredNames.has(candidate) ||
      external.has(candidate) ||
      PRIMITIVES.has(candidate) ||
      !TYPE_NAME.test(candidate)
    ) {
      continue;
    }
    const matches = [
      ...new Set(
        declarations
          .filter(
            ({ name, multiplicity: declarationMultiplicity }) =>
              declarationMultiplicity !== "element" && inflectionPair(name, candidate),
          )
          .map(({ name }) => name),
      ),
    ];
    if (matches.length === 1) accepted.add(candidate);
  }
  return [...accepted].sort();
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

function memberTypeEvidence(markdown: string): string[] {
  const fences = [...markdown.matchAll(/```(?:actions|queries)\r?\n([\s\S]*?)\r?\n```/g)];
  return [
    ...new Set(
      fences.flatMap(([, body]) =>
        (body ?? "")
          .split(/\r?\n/)
          .filter((line) => !/^\s/.test(line) && /^[a-z_][A-Za-z0-9_]*\s*\(/.test(line))
          .flatMap((line) => [...line.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)].map(([name]) => name)),
      ),
    ),
  ];
}

const STATE_SAMPLES: readonly {
  readonly label: string;
  readonly source: string;
  readonly externalTypes?: readonly string[];
  readonly evidenceTypeNames?: readonly string[];
}[] = [
  {
    label: "collections, elements, subsets, and fields",
    source: `a set of Items with
  a title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

an element Settings with
  a retentionDays Number

an Open set of Items

at most one Item has each title`,
    externalTypes: ["Person"],
    evidenceTypeNames: ["Item"],
  },
  {
    label: "field-only singular evidence",
    source:
      "a set of Accounts with\n  an account Account\n  a username Username\n  a aliases set of Alias",
  },
  {
    label: "external and primitive declaration subjects",
    source: "a set of People\n\na set of Strings\n\na Local set of People",
    externalTypes: ["People"],
  },
  {
    label: "inferred field names",
    source: "a set of Questions with\n  a Profile\n  a set of Options",
  },
  {
    label: "adversarial plural spellings without evidence",
    source: `a set of Chaoses

a set of Atlases

a set of Biases

a set of Buses

a set of Canvases

a set of Gases

a set of Lenses

a set of Mice`,
  },
  {
    label: "adversarial plural spellings with exact evidence",
    source: `a set of Chaoses

a set of Atlases

a set of Biases

a set of Buses

a set of Mice`,
    evidenceTypeNames: ["Chaos", "Atlas", "Bias", "Bus", "Mouse"],
  },
  {
    label: "element declarations remain exact",
    source: "an element Settings\n\nan element Canvas\n\nan element Mouse",
    evidenceTypeNames: ["Setting", "Canvases", "Mice"],
  },
];

function expectOracleAgreement(label: string, source: string, options: OracleOptions = {}): void {
  const parsed = parseSimpleStateForm(source, options);
  expect(parsed.diagnostics, label).toEqual([]);
  expect(ownedTypeNameSpellings(parsed.document.inventory), label).toEqual(
    oracleOwnedTypeNames(source, options),
  );
}

describe("owned type inventory audit oracle", () => {
  test("agrees with the SSF parser across focused structural State samples", () => {
    for (const { label, source, externalTypes: external, evidenceTypeNames } of STATE_SAMPLES) {
      expectOracleAgreement(label, source, {
        ...(external === undefined ? {} : { externalTypes: external }),
        ...(evidenceTypeNames === undefined ? {} : { evidenceTypeNames }),
      });
    }
  });

  test("agrees with the SSF parser for every catalog concept State", async () => {
    const entries = resolve(import.meta.dirname, "../../catalog/entries/concept");
    const concepts = (await readdir(entries, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();

    for (const concept of concepts) {
      const path = resolve(entries, concept, "spec.md");
      const markdown = await readFile(path, "utf8");
      expectOracleAgreement(path, stateFence(markdown), {
        externalTypes: externalTypes(markdown),
        evidenceTypeNames: memberTypeEvidence(markdown),
      });
    }
  });
});
