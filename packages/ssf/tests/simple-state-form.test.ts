import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ownedTypeNameSpellings,
  parseSimpleStateForm,
  validateSimpleStateForm,
} from "../src/simple-state-form.ts";
import { sourceLines, tokenizeSimpleStateForm } from "../src/source.ts";
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

  test("builds CRLF source lines with their own tokens", () => {
    const source = "first\r\n  second";
    expect(sourceLines(source, tokenizeSimpleStateForm(source))).toMatchObject([
      { text: "first", line: 1, start: 0, end: 5, tokens: [{ text: "first" }] },
      { text: "  second", line: 2, start: 7, end: 15, tokens: [{ text: "second" }] },
    ]);
  });

  test("does not synthesize a line after a trailing newline", () => {
    const source = "first\n";
    expect(sourceLines(source, tokenizeSimpleStateForm(source))).toMatchObject([
      { text: "first", line: 1, start: 0, end: 5 },
    ]);
  });

  test("represents an empty source as one empty line", () => {
    expect(sourceLines("", [])).toEqual([{ text: "", line: 1, start: 0, end: 0, tokens: [] }]);
  });

  test("retains a final unterminated line", () => {
    const source = "first\nsecond";
    expect(sourceLines(source, tokenizeSimpleStateForm(source))).toMatchObject([
      { text: "first", line: 1, start: 0, end: 5 },
      { text: "second", line: 2, start: 6, end: 12, tokens: [{ text: "second" }] },
    ]);
  });
});

describe("explicit prose rules", () => {
  const nearMissMarkers = ["rule:", "RULE:", "Invariant:", "invariant:", "Note:", "note:"] as const;

  test("retains top-level and attached `Rule:` lines without parsing their text", () => {
    const parsed = parseSimpleStateForm(`Rule: title String extra

a set of Items with
  a title String
  Rule: owner Person or Group`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.rules.map(({ text }) => text)).toEqual(["Rule: title String extra"]);
    expect(parsed.document.declarations[0]?.rules).toMatchObject([
      { text: "  Rule: owner Person or Group", span: { start: { line: 5, column: 1 } } },
    ]);
    expect(parsed.document.statements.map(({ kind }) => kind)).toEqual(["rule", "declaration"]);
  });

  test("requires `Rule:` to be a whole first token followed by text", () => {
    const valid = parseSimpleStateForm("Rule:\ttext\nRule:\u00a0more text");
    expect(valid.diagnostics).toEqual([]);
    expect(valid.document.rules.map(({ text }) => text)).toEqual([
      "Rule:\ttext",
      "Rule:\u00a0more text",
    ]);

    for (const source of ["Rule:x", "Rule:", "Rule:   ", "Rules: text", "Ruler: text"]) {
      const parsed = parseSimpleStateForm(source);
      expect(
        parsed.diagnostics.map(({ code }) => code),
        source,
      ).toEqual(["SSF_MALFORMED_DECLARATION"]);
      expect(parsed.document.rules, source).toEqual([]);
    }
  });

  test.each(nearMissMarkers)("diagnoses near-miss prose marker %s", (marker) => {
    const parsed = parseSimpleStateForm(`${marker} each item may have a note`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_NEAR_MISS_KEYWORD",
        message: `Use the exact SSF prose marker \`Rule:\` instead of \`${marker}\`.`,
        suggestion: "Rule: each item may have a note",
        span: { start: { line: 1, column: 1 } },
      },
    ]);
    expect(parsed.document.rules).toEqual([]);
  });

  test("preserves indentation when repairing an attached near-miss marker", () => {
    const source = `a set of Items with
  rule: attached
  title String`;
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics).toMatchObject([
      {
        severity: "error",
        code: "SSF_NEAR_MISS_KEYWORD",
        suggestion: "  Rule: attached",
        span: {
          start: { line: 2, column: 3 },
          end: { line: 2, column: 8 },
        },
      },
    ]);
    const repaired = source.replace("  rule: attached", parsed.diagnostics[0]!.suggestion);
    expect(parseSimpleStateForm(repaired).diagnostics).toEqual([]);
    expect(parseSimpleStateForm(repaired).document.declarations[0]).toMatchObject({
      fields: [{ name: "title" }],
      rules: [{ text: "  Rule: attached" }],
    });
  });

  test.each(nearMissMarkers)("applies the whole-token and text contract to %s", (marker) => {
    for (const source of [marker, `${marker}   `, `${marker}text`]) {
      expect(
        parseSimpleStateForm(source).diagnostics.map(({ code }) => code),
        source,
      ).toEqual(["SSF_MALFORMED_DECLARATION"]);
    }
  });

  test("uses Unicode whitespace consistently for indentation and marker tokens", () => {
    const parsed = parseSimpleStateForm(`a set of Items with
\u00a0Rule: attached
\u00a0owner String`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]).toMatchObject({
      fields: [{ name: "owner" }],
      rules: [{ text: "\u00a0Rule: attached" }],
    });
  });

  test("diagnoses unmarked prose according to its syntactic position", () => {
    const parsed = parseSimpleStateForm(`Each item may have a note

a set of Items with
  a title String
  Each item may have a note`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_DECLARATION",
        message: "This top-level line is not an SSF declaration, alias, or `Rule:` line.",
        span: { start: { line: 1, column: 1 } },
      },
      {
        code: "SSF_MALFORMED_FIELD",
        message: "This indented line is not an SSF field or `Rule:` line.",
        span: { start: { line: 5, column: 1 } },
      },
    ]);
    expect(parsed.document.rules).toEqual([]);
  });

  test("separates valid orphaned body lines from malformed fields", () => {
    const parsed = parseSimpleStateForm(`  Rule: orphan
  owner String
  a Profile
  owner`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_ORPHANED_LINE",
        message: "This indented `Rule:` line has no enclosing SSF declaration.",
      },
      {
        code: "SSF_ORPHANED_LINE",
        message: "This valid SSF field has no enclosing SSF declaration.",
      },
      {
        code: "SSF_ORPHANED_LINE",
        message: "This valid SSF field has no enclosing SSF declaration.",
      },
      { code: "SSF_MALFORMED_FIELD" },
    ]);
  });

  test("gives an orphaned near-miss marker a complete repair", () => {
    expect(parseSimpleStateForm("  rule: orphan").diagnostics).toMatchObject([
      {
        code: "SSF_ORPHANED_LINE",
        message:
          "This indented `rule:` line has no enclosing SSF declaration and does not use the exact `Rule:` marker.",
        suggestion:
          "Add an enclosing declaration and use `Rule:`; or unindent the corrected line to make it a top-level rule.",
      },
    ]);
  });

  test("allows declaration-attached rules without `with` and ends the body at a top-level rule", () => {
    const attached = parseSimpleStateForm(`a set of Items
  Rule: attached`);
    expect(attached.diagnostics).toEqual([]);
    expect(attached.document.declarations[0]?.rules).toMatchObject([{ text: "  Rule: attached" }]);

    const ended = parseSimpleStateForm(`a set of Items with
  Rule: before
  a title String
  Rule: after
Rule: top-level
  owner String`);
    expect(ended.document.declarations[0]).toMatchObject({
      fields: [{ name: "title" }],
      rules: [{ text: "  Rule: before" }, { text: "  Rule: after" }],
    });
    expect(ended.document.rules).toMatchObject([{ text: "Rule: top-level" }]);
    expect(ended.diagnostics).toMatchObject([
      {
        code: "SSF_ORPHANED_LINE",
        message: "This valid SSF field has no enclosing SSF declaration.",
        span: { start: { line: 6 } },
      },
    ]);
  });

  test("requires a real field after `with`; an attached rule does not satisfy it", () => {
    const ruleOnly = parseSimpleStateForm(`a set of Items with
  Rule: Each item may have a note`);
    expect(ruleOnly.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_DECLARATION",
        message: "A declaration ending in `with` must have at least one indented field.",
        suggestion: "Remove `with` or add at least one indented field.",
      },
    ]);
    expect(ruleOnly.document.declarations[0]).toMatchObject({
      fields: [],
      rules: [{ text: "  Rule: Each item may have a note" }],
    });

    expect(
      parseSimpleStateForm(`a set of Items with
  Rule: Each item may have a note
  a title String`).diagnostics,
    ).toEqual([]);
  });

  test.each(["title String extra", "Profile extra", "owner Person or Group"])(
    "diagnoses the invalid field %s instead of swallowing it as prose",
    (line) => {
      const parsed = parseSimpleStateForm(`a set of Items with
  a valid String
  ${line}`);
      expect(parsed.diagnostics).toMatchObject([
        { code: "SSF_MALFORMED_FIELD", span: { start: { line: 3, column: 1 } } },
      ]);
      expect(parsed.document.rules).toEqual([]);
    },
  );
});

describe("structural parsing and explicit aliases", () => {
  test("parses declarations, fields, aliases, references, and marked rule prose", () => {
    const source = `a set of Items with
  a title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

an Open set of Items

an element Settings with
  a retentionDays Number

alias Item for Items

Rule: at most one Item has each title`;
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
    expect(parsed.document.rules).toMatchObject([
      { text: "Rule: at most one Item has each title" },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Item",
      "Items",
      "Open",
      "Settings",
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toContain("Item");
    expect(ownedTypeNameSpellings(parsed.document.inventory)).not.toContain("Person");
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

describe("collection fields", () => {
  test("parses named and enum set/sequence elements with optional collection `of`", () => {
    const parsed = parseSimpleStateForm(
      `a set of Palettes with
  a flags set of RED or BLUE
  a modes seq ACTIVE or PAUSED
  a watchers set of Person
  a reviewers seq Person`,
      { externalTypes: ["Person"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        name: "flags",
        value: {
          kind: "collection",
          multiplicity: "set",
          element: {
            kind: "enumeration",
            values: ["RED", "BLUE"],
            span: {
              start: { line: 2, column: 18 },
              end: { line: 2, column: 29 },
            },
          },
          span: { start: { line: 2, column: 11 }, end: { line: 2, column: 29 } },
        },
      },
      {
        name: "modes",
        value: {
          kind: "collection",
          multiplicity: "sequence",
          element: {
            kind: "enumeration",
            values: ["ACTIVE", "PAUSED"],
            span: {
              start: { line: 3, column: 15 },
              end: { line: 3, column: 31 },
            },
          },
        },
      },
      {
        name: "watchers",
        value: { element: { reference: { text: "Person", referenceKind: "external" } } },
      },
      {
        name: "reviewers",
        value: { element: { reference: { text: "Person", referenceKind: "external" } } },
      },
    ]);
  });

  test.each([
    ["enum values without an explicit field name", "a set of RED or BLUE", 23],
    ["a doubled collection `of`", "a flags set of of RED or BLUE", 32],
    ["a scalar enum without its `of` marker", "a status RED or BLUE", 23],
  ])("rejects %s", (_, field, column) => {
    const parsed = parseSimpleStateForm(`a set of Palettes with
  a name String
  ${field}`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_FIELD",
        span: { start: { line: 3, column: 1 }, end: { line: 3, column } },
      },
    ]);
  });

  test("diagnoses an unnamed scalar enum but retains an attached rule", () => {
    const parsed = parseSimpleStateForm(`a set of Items with
  a name String
  of OPEN or DONE
  Rule: each item may have a note`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_FIELD",
        span: {
          start: { line: 3, column: 1 },
          end: { line: 3, column: 18 },
        },
      },
    ]);
    expect(parsed.document.declarations[0]?.rules).toMatchObject([
      { text: "  Rule: each item may have a note", span: { start: { line: 4, column: 1 } } },
    ]);
  });

  test("locates duplicate values in collection enums", () => {
    const parsed = parseSimpleStateForm(`a set of Palettes with
  a flags set of RED or RED`);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_DUPLICATE_ENUM_VALUE",
        span: {
          start: { line: 2, column: 25 },
          end: { line: 2, column: 28 },
        },
      },
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
    expect(parsed.document.inventory.ownedTypeNames).toEqual(["Mice", "Mouse"]);
  });

  test("never inserts pluralizer output or follows aliases transitively", () => {
    const withoutEvidence = parseSimpleStateForm("a set of Mice");
    expect(ownedTypeNameSpellings(withoutEvidence.document.inventory)).toEqual(["Mice"]);

    const withEvidence = parseSimpleStateForm("a set of Mice", {
      evidenceTypeNames: ["Mouse"],
    });
    expect(ownedTypeNameSpellings(withEvidence.document.inventory)).toEqual(["Mice", "Mouse"]);
    for (const unauthored of ["Mices", "MouseS", "Mouses"]) {
      expect(ownedTypeNameSpellings(withEvidence.document.inventory)).not.toContain(unauthored);
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

  test("advises when one automatic candidate matches several owners", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toMatchObject([
      {
        severity: "advice",
        code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS",
        message:
          'Automatic alias inference rejected candidate spellings "Axes" for owners "Ax", "Axis" because the authored relation is not one-to-one.',
        span: { start: { line: 1, column: 10 } },
      },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Ax", "Axis"]);
  });

  test("advises when one owner would receive several automatic candidates", () => {
    const parsed = parseSimpleStateForm(`a set of Axes with
  a short Ax
  an anatomical Axis`);
    expect(parsed.diagnostics).toMatchObject([
      {
        severity: "advice",
        code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS",
        message:
          'Automatic alias inference rejected candidate spellings "Ax", "Axis" for owners "Axes" because the authored relation is not one-to-one.',
        span: { start: { line: 1, column: 10 } },
      },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Axes"]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { value: { reference: { text: "Ax", referenceKind: "unresolved" } } },
      { value: { reference: { text: "Axis", referenceKind: "unresolved" } } },
    ]);
  });

  test("advises for both sides of a mixed automatic-alias ambiguity", () => {
    const parsed = parseSimpleStateForm(`a set of These with
  a singular This
  a shared Theses

a set of Thesis`);
    expect(parsed.diagnostics).toMatchObject([
      {
        severity: "advice",
        code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS",
        message:
          'Automatic alias inference rejected candidate spellings "Theses" for owners "These", "Thesis" because the authored relation is not one-to-one.',
      },
      {
        severity: "advice",
        code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS",
        message:
          'Automatic alias inference rejected candidate spellings "Theses", "This" for owners "These" because the authored relation is not one-to-one.',
      },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["These", "Thesis"]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { value: { reference: { text: "This", referenceKind: "unresolved" } } },
      { value: { reference: { text: "Theses", referenceKind: "unresolved" } } },
    ]);
  });

  test("does not count explicit aliases against owner-side automatic uniqueness", () => {
    const parsed = parseSimpleStateForm(`a set of Items with
  an Item

alias WorkItem for Items

alias TaskItem for Items`);
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Item",
      "Items",
      "TaskItem",
      "WorkItem",
    ]);
  });

  test("lets a valid explicit alias resolve an ambiguous automatic candidate", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis\n\nalias Axes for Axis", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.ownedTypeNames).toEqual(["Ax", "Axes", "Axis"]);
  });

  test("gives an exact structural declaration precedence over automatic matching", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis\n\na set of Axes", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.ownedTypeNames).toEqual(["Ax", "Axes", "Axis"]);
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

  test("rejects a subset parent with duplicate structural declarations", () => {
    const parsed = parseSimpleStateForm(
      "a Child set of Roots\n\na set of Roots\n\nan element Roots",
    );
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_INVALID_SUBSET_PARENT", span: { start: { line: 1, column: 16 } } },
      { code: "SSF_DUPLICATE_DECLARATION", span: { start: { line: 5, column: 12 } } },
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
    expect(first.map(({ span }) => span!.start.line)).toEqual([1, 3, 5]);
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

  test("rejects primitive names from the external inventory before classifying references", () => {
    const parsed = parseSimpleStateForm(
      `a set of Items with
  a value String`,
      {
        externalTypes: ["String"],
      },
    );
    expect(parsed.diagnostics).toMatchObject([
      {
        severity: "error",
        code: "SSF_NAME_COLLISION",
        message: 'External type "String" collides with the SSF primitive of the same name.',
        externalType: "String",
      },
    ]);
    expect(parsed.diagnostics[0]).not.toHaveProperty("span");
    expect(parsed.document.inventory.external).toEqual([]);
    expect(parsed.document.inventory.primitives).toContain("String");
    expect(parsed.document.declarations[0]?.fields[0]?.value).toMatchObject({
      reference: { text: "String", referenceKind: "primitive" },
    });
  });

  test.each(["person", "_Person"])(
    "rejects external name %s outside the SSF type-name grammar",
    (name) => {
      const parsed = parseSimpleStateForm("", { externalTypes: [name] });
      expect(parsed.diagnostics).toMatchObject([
        {
          severity: "error",
          code: "SSF_INVALID_EXTERNAL_NAME",
          message: `External type ${JSON.stringify(name)} is not a valid SSF type name.`,
          externalType: name,
        },
      ]);
      expect(parsed.diagnostics[0]).not.toHaveProperty("span");
      expect(parsed.document.inventory.external).toEqual([]);
    },
  );

  test("reports exact declaration and alias occurrences for duplicate collision combinations", () => {
    const parsed = parseSimpleStateForm(
      `a set of Person

an element Person

a seq of Person

alias Person for Person

alias Person for Person

alias Spare for Person

alias Spare for Person

alias Spare for Person`,
      { externalTypes: ["Person"] },
    );
    const localCodes = new Set([
      "SSF_DUPLICATE_DECLARATION",
      "SSF_NAME_COLLISION",
      "SSF_ALIAS_NAME_COLLISION",
    ]);
    expect(
      parsed.diagnostics
        .filter(({ code }) => localCodes.has(code))
        .map(({ code, span }) => [code, span!.start.line, span!.start.column]),
    ).toEqual([
      ["SSF_NAME_COLLISION", 1, 10],
      ["SSF_DUPLICATE_DECLARATION", 3, 12],
      ["SSF_NAME_COLLISION", 3, 12],
      ["SSF_DUPLICATE_DECLARATION", 5, 10],
      ["SSF_NAME_COLLISION", 5, 10],
      ["SSF_ALIAS_NAME_COLLISION", 7, 7],
      ["SSF_ALIAS_NAME_COLLISION", 9, 7],
      ["SSF_ALIAS_NAME_COLLISION", 13, 7],
      ["SSF_ALIAS_NAME_COLLISION", 15, 7],
    ]);
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
    expect(inventory.ownedTypeNames).toEqual(["Human", "People", "Person"]);
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
      { code: "SSF_MISPLACED_OPTIONAL", suggestion: "  an optional revokedAt DateTime" },
      { code: "SSF_OPTIONAL_COLLECTION" },
      { code: "SSF_ARTICLE", suggestion: "an element Settings with" },
    ]);
  });

  test("diagnoses malformed structural lines and orphan fields while retaining invariant prose", () => {
    const source = `a set of Records with garbage
  a owner

Rule: at most one Item has each owner`;
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "SSF_MALFORMED_DECLARATION",
      "SSF_MALFORMED_FIELD",
    ]);
    expect(parsed.document.rules.map(({ text }) => text)).toEqual([
      "Rule: at most one Item has each owner",
    ]);
  });
});

describe("repository SSF corpus", () => {
  test("parses the packaged skill example and retains its teaching structures", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const markdown = await readFile(
      resolve(root, "packages/skill/skills/sync-engine/prompts/common/ssf.md"),
      "utf8",
    );
    const parsed = parseSimpleStateForm(stateFence(markdown), { externalTypes: ["Person"] });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toMatchObject([
      {
        name: { text: "Items", referenceKind: "owned" },
        fields: [
          { name: "title", inferredName: false, value: { kind: "named" } },
          {
            name: "item",
            inferredName: true,
            value: {
              kind: "named",
              reference: { text: "Item", normalized: "Items", referenceKind: "owned" },
            },
          },
          {
            name: "owner",
            optional: true,
            value: { reference: { text: "Person", referenceKind: "external" } },
          },
          {
            name: "watchers",
            inferredName: false,
            value: { kind: "collection", multiplicity: "set" },
          },
          {
            name: "updates",
            inferredName: true,
            value: {
              kind: "collection",
              multiplicity: "sequence",
              element: { reference: { text: "Updates", referenceKind: "unresolved" } },
            },
          },
          {
            name: "status",
            value: { kind: "enumeration", values: ["OPEN", "DONE"] },
          },
        ],
      },
      {
        name: { text: "Completed", referenceKind: "owned" },
        declarationKind: "subset",
        fields: [{ name: "completedAt" }],
      },
      {
        name: { text: "Settings", referenceKind: "owned" },
        multiplicity: "element",
        fields: [{ name: "retentionDays" }],
      },
    ]);
    expect(parsed.document.aliases).toMatchObject([
      {
        name: { text: "WorkItem", referenceKind: "owned" },
        target: { text: "Items", referenceKind: "owned" },
      },
    ]);
    expect(parsed.document.rules).toMatchObject([
      { text: "Rule: at most one Item has each owner and title pair" },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Completed",
      "Item",
      "Items",
      "Settings",
      "WorkItem",
    ]);
  });

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
      expect(
        parsed.diagnostics.filter(({ severity }) => severity === "error"),
        path,
      ).toEqual([]);
      for (const name of ownedTypeNameSpellings(parsed.document.inventory)) {
        expect(markdown, `${path} must author owned spelling ${name}`).toContain(name);
      }
      count += 1;
    }
    expect(count).toBeGreaterThan(20);
  });
});
