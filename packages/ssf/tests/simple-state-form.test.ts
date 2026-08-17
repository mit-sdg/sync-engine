import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isOwnedTypeName,
  ownedTypeNameSpellings,
  parseSimpleStateForm,
  tokenizeSimpleStateForm,
  validateSimpleStateForm,
} from "../src/index.ts";
import { describe, expect, test } from "vite-plus/test";

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
  return [...markdown.matchAll(/```(?:actions|queries)\r?\n([\s\S]*?)\r?\n```/g)].flatMap(
    ([, body]) =>
      (body ?? "")
        .split(/\r?\n/)
        .filter((line) => !/^\s/.test(line) && /^[a-z_][A-Za-z0-9_]*\s*\(/.test(line))
        .flatMap((line) => [...line.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)].map(([name]) => name)),
  );
}

function codes(source: string, external: readonly string[] = []): readonly string[] {
  return parseSimpleStateForm(source, { externalTypes: external }).diagnostics.map(
    ({ code }) => code,
  );
}

describe("SSF source model", () => {
  test("retains every token and exact one-based positions", () => {
    const source = "a set of Items with\r\n  a title String";
    const tokens = tokenizeSimpleStateForm(source);
    expect(tokens.map(({ text }) => text).join("")).toBe(source);
    expect(tokens.filter(({ kind }) => kind === "word").at(-1)).toMatchObject({
      text: "String",
      span: {
        start: { offset: 31, line: 2, column: 11 },
        end: { offset: 37, line: 2, column: 17 },
      },
    });
  });
});

describe("structural parsing and explicit aliases", () => {
  test("parses declarations, fields, aliases, references, and opaque prose", () => {
    const source = `a set of Items with
  a title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

an Open set of Items

an element Settings with
  a retentionDays Number

alias Item for Items

at most one Item has each title`;
    const parsed = parseSimpleStateForm(source, { externalTypes: ["Person"] });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toHaveLength(3);
    expect(parsed.document.aliases).toMatchObject([
      {
        name: { text: "Item", normalized: "Items", referenceKind: "owned" },
        target: { text: "Items", normalized: "Items", referenceKind: "owned" },
      },
    ]);
    expect(parsed.document.declarations[0]).toMatchObject({
      name: { text: "Items", referenceKind: "owned" },
      fields: [
        { name: "title", value: { reference: { referenceKind: "primitive" } } },
        { name: "owner", optional: true, value: { reference: { referenceKind: "external" } } },
        { name: "watchers", value: { element: { reference: { referenceKind: "external" } } } },
        { name: "status", value: { values: ["OPEN", "DONE"] } },
      ],
    });
    expect(parsed.document.declarations[1]).toMatchObject({
      name: { text: "Open", referenceKind: "owned" },
      parent: { text: "Items", referenceKind: "owned" },
    });
    expect(parsed.document.opaqueLines).toMatchObject([
      { text: "at most one Item has each title" },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Item",
      "Items",
      "Open",
      "Settings",
    ]);
    expect(isOwnedTypeName(parsed.document.inventory, "Item")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Person")).toBe(false);
  });

  test("derives a regular alias only from an exact authored field type", () => {
    const parsed = parseSimpleStateForm(`a set of Accounts with
  an account Account
  a usernames set of Username`);
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Account", "Accounts"]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        value: {
          reference: { text: "Account", normalized: "Accounts", referenceKind: "owned" },
        },
      },
      { value: { element: { reference: { text: "Username", referenceKind: "unresolved" } } } },
    ]);
  });

  test("infers field names but retains unresolved State value names as authored references", () => {
    const parsed = parseSimpleStateForm(`a set of Questions with
  a Profile
  a set of Options
  a status StatusCode`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        name: "profile",
        inferredName: true,
        value: { reference: { referenceKind: "unresolved" } },
      },
      {
        name: "options",
        inferredName: true,
        value: { element: { reference: { referenceKind: "unresolved" } } },
      },
      { name: "status", value: { reference: { referenceKind: "unresolved" } } },
    ]);
  });
});

describe("safe automatic aliases", () => {
  test.each([
    ["Mice", "Mouse"],
    ["People", "Person"],
    ["Items", "Item"],
    ["Chaoses", "Chaos"],
  ])("relates exact authored %s and %s spellings", (declaration, candidate) => {
    const parsed = parseSimpleStateForm(`a set of ${declaration}`, {
      evidenceTypeNames: [candidate],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(
      [candidate, declaration].sort(),
    );
  });

  test("can compare an authored plural candidate against a singular structural spelling", () => {
    const parsed = parseSimpleStateForm("a set of Mouse", { evidenceTypeNames: ["Mice"] });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Mouse", declaredNames: ["Mice", "Mouse"] },
    ]);
  });

  test("never inserts pluralizer output or follows aliases transitively", () => {
    const withoutEvidence = parseSimpleStateForm("a set of Mice");
    expect(ownedTypeNameSpellings(withoutEvidence.document.inventory)).toEqual(["Mice"]);

    const withEvidence = parseSimpleStateForm("a set of Mice", {
      evidenceTypeNames: ["Mouse"],
    });
    expect(ownedTypeNameSpellings(withEvidence.document.inventory)).toEqual(["Mice", "Mouse"]);
    for (const unauthored of ["Mices", "MouseS", "Mouses"]) {
      expect(isOwnedTypeName(withEvidence.document.inventory, unauthored)).toBe(false);
    }
  });

  test("excludes elements, externals, and primitives from automatic aliases", () => {
    const element = parseSimpleStateForm("an element People", {
      evidenceTypeNames: ["Person"],
    });
    expect(ownedTypeNameSpellings(element.document.inventory)).toEqual(["People"]);

    const external = parseSimpleStateForm("a set of People", {
      externalTypes: ["Person"],
      evidenceTypeNames: ["Person"],
    });
    expect(ownedTypeNameSpellings(external.document.inventory)).toEqual(["People"]);

    const primitive = parseSimpleStateForm("a set of Strings", {
      evidenceTypeNames: ["String"],
    });
    expect(ownedTypeNameSpellings(primitive.document.inventory)).toEqual(["Strings"]);
  });

  test("leaves an ambiguous plural candidate unresolved", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Ax", "Axis"]);
  });

  test("lets a valid explicit alias resolve an ambiguous automatic candidate", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis\n\nalias Axes for Axis", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Ax", declaredNames: ["Ax"] },
      { name: "Axis", declaredNames: ["Axes", "Axis"] },
    ]);
  });

  test("gives an exact structural declaration precedence over automatic matching", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis\n\na set of Axes", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Ax", declaredNames: ["Ax"] },
      { name: "Axes", declaredNames: ["Axes"] },
      { name: "Axis", declaredNames: ["Axis"] },
    ]);
  });

  test("is invariant to structural and evidence declaration order", () => {
    const first = parseSimpleStateForm("a set of Mice\n\na set of People", {
      evidenceTypeNames: ["Mouse", "Person"],
    });
    const second = parseSimpleStateForm("a set of People\n\na set of Mice", {
      evidenceTypeNames: ["Person", "Mouse"],
    });
    expect(ownedTypeNameSpellings(first.document.inventory)).toEqual(
      ownedTypeNameSpellings(second.document.inventory),
    );
  });
});

describe("subset graph integrity", () => {
  test.each([
    `a Leaf set of Branch

a Branch set of Roots

a set of Roots`,
    `a set of Roots

a Leaf set of Branch

a Branch set of Roots`,
    `a Branch set of Roots

a set of Roots

a Leaf set of Branch`,
  ])("accepts forward references and valid chains independent of declaration order", (source) => {
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Branch", "Leaf", "Roots"]);
  });

  test.each([
    ["a Child set of Missing", [], "unresolved"],
    ["a Child set of Person", ["Person"], "external"],
    ["a Child set of String", [], "primitive"],
  ])("rejects a %s subset parent", (source, external, referenceKind) => {
    const parsed = parseSimpleStateForm(source, { externalTypes: external as string[] });
    expect(parsed.diagnostics).toMatchObject([{ code: "SSF_INVALID_SUBSET_PARENT" }]);
    expect(parsed.document.declarations.at(-1)?.parent?.referenceKind).toBe(referenceKind);
  });

  test.each([
    `a set of Roots

alias Root for Roots

a Child set of Root`,
    `a Child set of Root

alias Root for Roots

a set of Roots`,
    `alias Root for Roots

a set of Roots

a Child set of Root`,
  ])("resolves an exact parent alias independent of declaration order", (source) => {
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(
      parsed.document.declarations.find(({ name }) => name.text === "Child")?.parent,
    ).toMatchObject({
      text: "Root",
      normalized: "Roots",
      referenceKind: "owned",
    });
  });

  test("resolves an evidenced automatic alias as a subset parent", () => {
    const parsed = parseSimpleStateForm(`a Child set of Item

a set of Items with
  a parent Item`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.parent).toMatchObject({
      text: "Item",
      normalized: "Items",
      referenceKind: "owned",
    });
  });

  test("detects canonical subset cycles through aliases", () => {
    const parsed = parseSimpleStateForm(`a A set of Bee

a B set of A

alias Bee for B`);
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "SSF_SUBSET_CYCLE",
      "SSF_SUBSET_CYCLE",
      "SSF_INVALID_ALIAS_TARGET",
    ]);
  });

  test("detects self-parenting through an exact alias", () => {
    const parsed = parseSimpleStateForm("a Loop set of Loops\n\nalias Loops for Loop");
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_SUBSET_SELF_PARENT", span: { start: { line: 1, column: 15 } } },
      { code: "SSF_INVALID_ALIAS_TARGET", span: { start: { line: 3 } } },
    ]);
  });

  test("rejects a subset whose structurally named parent has an invalid chain", () => {
    const parsed = parseSimpleStateForm("a Child set of Parent\n\na Parent set of Missing");
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_INVALID_SUBSET_PARENT", span: { start: { line: 1 } } },
      { code: "SSF_INVALID_SUBSET_PARENT", span: { start: { line: 3 } } },
    ]);
  });

  test("rejects self-parenting at the parent span", () => {
    const parsed = parseSimpleStateForm("a Loop set of Loop");
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_SUBSET_SELF_PARENT", span: { start: { line: 1, column: 15 } } },
    ]);
  });

  test("rejects every edge in multi-node cycles deterministically", () => {
    const source = "a B set of C\n\na C set of A\n\na A set of B";
    const first = parseSimpleStateForm(source).diagnostics;
    const second = parseSimpleStateForm(source).diagnostics;
    expect(first).toEqual(second);
    expect(first.map(({ code }) => code)).toEqual([
      "SSF_SUBSET_CYCLE",
      "SSF_SUBSET_CYCLE",
      "SSF_SUBSET_CYCLE",
    ]);
    expect(first.map(({ span }) => span.start.line)).toEqual([1, 3, 5]);
  });
});

describe("exact namespace and local uniqueness", () => {
  test("rejects duplicate structural declarations", () => {
    expect(codes("a set of Items\n\nan element Items")).toContain("SSF_DUPLICATE_DECLARATION");
  });

  test.each([
    ["a set of Person", ["Person"]],
    ["an element String", []],
  ])("rejects declaration collisions with external and primitive names", (source, external) => {
    expect(codes(source, external)).toContain("SSF_NAME_COLLISION");
  });

  test("rejects duplicate explicit and inferred effective field names only within a declaration", () => {
    const parsed = parseSimpleStateForm(`a set of First with
  a profile String
  a Profile

a set of Second with
  a profile String`);
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_DUPLICATE_FIELD", span: { start: { line: 3 } } },
    ]);
  });

  test("rejects repeated enum values but permits the same value in distinct fields", () => {
    const parsed = parseSimpleStateForm(`a set of Items with
  a status of OPEN or OPEN
  a mode of OPEN or CLOSED`);
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_DUPLICATE_ENUM_VALUE", span: { start: { line: 2, column: 23 } } },
    ]);
  });
});

describe("alias integrity", () => {
  test.each([
    `alias Item for Items

a set of Items`,
    `a set of Items

alias Item for Items`,
  ])("allows an exact alias to target a structural declaration in either order", (source) => {
    expect(parseSimpleStateForm(source).diagnostics).toEqual([]);
  });

  test("allows separately named aliases with one deterministic owner", () => {
    const inventory = parseSimpleStateForm(`a set of People

alias Person for People

alias Human for People`).document.inventory;
    expect(inventory.types).toMatchObject([
      { name: "People", declaredNames: ["Human", "People", "Person"] },
    ]);
  });

  test.each([
    ["alias Missing for Unknown", [], "unresolved"],
    ["alias Human for Person", ["Person"], "external"],
    ["alias Text for String", [], "primitive"],
    ["a set of Items\n\nalias Item for Items\n\nalias Thing for Item", [], "chain"],
  ])("rejects invalid alias target: %s", (source, external) => {
    expect(codes(source, external as string[])).toContain("SSF_INVALID_ALIAS_TARGET");
  });

  test.each([
    ["a set of Items\n\nalias Items for Items", []],
    ["a set of Items\n\nalias Person for Items", ["Person"]],
    ["a set of Items\n\nalias String for Items", []],
    ["a set of Items\n\nalias Item for Items\n\nalias Item for Items", []],
  ])("rejects an alias namespace collision: %s", (source, external) => {
    expect(codes(source, external as string[])).toContain("SSF_ALIAS_NAME_COLLISION");
  });

  test("diagnoses malformed alias-like lines rather than treating them as prose", () => {
    expect(validateSimpleStateForm("alias Item to Items")).toMatchObject([
      { code: "SSF_MALFORMED_ALIAS", span: { start: { line: 1, column: 1 } } },
    ]);
  });
});

describe("canonical repair diagnostics", () => {
  test("retains established deterministic structural repairs", () => {
    const source = `a sequence of Sessions
  a revokedAt optional DateTime

a set of Groups with
  an optional members seq of Person

a element Settings with
  a retentionDays Number`;
    expect(validateSimpleStateForm(source)).toMatchObject([
      { code: "SSF_NEAR_MISS_KEYWORD", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISSING_WITH", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISPLACED_OPTIONAL", suggestion: "an optional revokedAt DateTime" },
      { code: "SSF_OPTIONAL_COLLECTION" },
      { code: "SSF_ARTICLE", suggestion: "an element Settings with" },
    ]);
  });

  test("diagnoses malformed structural lines and orphan fields while retaining invariant prose", () => {
    const source = `a set of Records with garbage
  a owner

at most one Item has each owner`;
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "SSF_MALFORMED_DECLARATION",
      "SSF_MALFORMED_FIELD",
    ]);
    expect(parsed.document.opaqueLines.map(({ text }) => text)).toEqual([
      "a set of Records with garbage",
      "  a owner",
      "at most one Item has each owner",
    ]);
  });
});

describe("repository SSF corpus", () => {
  test("validates every catalog and application concept with explicit inventories", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const directories = [
      "packages/catalog/entries/concept",
      "examples",
      "tests/packaging/application/src/concepts",
      "packages/http/tests/packaging",
    ];
    const paths = (
      await Promise.all(
        directories.map(async (directory) =>
          (await readdir(resolve(root, directory), { recursive: true }))
            .filter((path) => path.endsWith(".md"))
            .map((path) => `${directory}/${path}`),
        ),
      )
    ).flat();
    let count = 0;
    for (const path of paths) {
      const markdown = await readFile(resolve(root, path), "utf8");
      if (!markdown.includes("```state")) continue;
      const parsed = parseSimpleStateForm(stateFence(markdown), {
        externalTypes: externalTypes(markdown),
        evidenceTypeNames: memberTypeEvidence(markdown),
      });
      expect(parsed.diagnostics, path).toEqual([]);
      for (const name of ownedTypeNameSpellings(parsed.document.inventory)) {
        expect(markdown, `${path} must author owned spelling ${name}`).toContain(name);
      }
      count += 1;
    }
    expect(count).toBeGreaterThan(20);
  });
});
