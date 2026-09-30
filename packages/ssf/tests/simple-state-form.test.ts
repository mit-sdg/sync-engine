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

function localTypes(markdown: string): { name: string; values?: readonly string[] }[] {
  const body = /```types\r?\n([\s\S]*?)\r?\n```/.exec(markdown)?.[1] ?? "";
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
        message: "This indented line is not an SSF field, uniqueness constraint, or `Rule:` line.",
        span: { start: { line: 5, column: 1 } },
      },
    ]);
    expect(parsed.document.rules).toEqual([]);
  });

  test("separates valid orphaned body lines from malformed fields", () => {
    const parsed = parseSimpleStateForm(`  Rule: orphan
  owner String
  a profile Profile
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
        message:
          "A declaration ending in `with` must have at least one indented field or constraint.",
        suggestion: "Remove `with` or add an indented field or uniqueness constraint.",
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
  a status Status

a set of Open Items where status is OPEN

an element Settings with
  a retentionDays Number

alias Item for Items

Rule: at most one Item has each title`;
    const parsed = parseSimpleStateForm(source, {
      externalTypes: ["Person"],
      localTypes: [{ name: "Status", values: ["OPEN", "DONE"] }],
    });
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
        { name: "status", value: { reference: { referenceKind: "local" } } },
      ],
    });
    expect(parsed.document.declarations[1]).toMatchObject({
      name: { text: "Open Items", normalized: "Open Items", referenceKind: "subset" },
      qualifier: "Open",
      parent: { text: "Items", normalized: "Items", referenceKind: "owned" },
      condition: { field: "status", values: ["OPEN"] },
    });
    expect(parsed.document.rules).toMatchObject([
      { text: "Rule: at most one Item has each title" },
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Item",
      "Items",
      "Settings",
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toContain("Item");
    expect(ownedTypeNameSpellings(parsed.document.inventory)).not.toContain("Person");
  });

  test("derives a regular alias only from an exact authored field type", () => {
    const parsed = parseSimpleStateForm(
      `a set of Accounts with
  an account Account
  a usernames set of Username`,
      { externalTypes: ["Username"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Account", "Accounts"]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        value: {
          reference: { text: "Account", normalized: "Accounts", referenceKind: "owned" },
        },
      },
      { value: { element: { reference: { text: "Username", referenceKind: "external" } } } },
    ]);
  });

  test("reports an undeclared State value name and retains it as authored", () => {
    const parsed = parseSimpleStateForm(`a set of Questions with
  a profile Profile
  an options set of Options
  a status StatusCode`);
    expect(parsed.diagnostics).toMatchObject([
      { severity: "error", code: "SSF_UNDECLARED_TYPE", span: { start: { line: 2 } } },
      { code: "SSF_UNDECLARED_TYPE", span: { start: { line: 3 } } },
      { code: "SSF_UNDECLARED_TYPE", span: { start: { line: 4 } } },
    ]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { name: "profile", value: { reference: { text: "Profile", referenceKind: "unresolved" } } },
      { name: "options", value: { element: { reference: { referenceKind: "unresolved" } } } },
      { name: "status", value: { reference: { referenceKind: "unresolved" } } },
    ]);
  });

  test("suggests a repair that is itself valid, or none at all", () => {
    const [misordered] = parseSimpleStateForm(`a set of Items with\n  a String unique`).diagnostics;
    expect(misordered).toMatchObject({
      code: "SSF_MISPLACED_MODIFIER",
      suggestion: "  a unique String",
    });
    expect(
      parseSimpleStateForm(`a set of Items with\n${misordered!.suggestion}`).diagnostics,
    ).toEqual([]);
    // No repair exists for an optional collection, so none is offered.
    expect(
      parseSimpleStateForm(`a set of Items with\n  a optional set of Person`, {
        externalTypes: ["Person"],
      }).diagnostics,
    ).toMatchObject([
      { code: "SSF_OPTIONAL_COLLECTION", suggestion: "Remove `optional` from this field." },
    ]);
  });

  test.each([
    ["a scalar value", "a Profile", "profile", "named"],
    ["a modified scalar value", "an optional unique Profile", "profile", "named"],
    ["a named collection", "a set of Options", "options", "collection"],
    ["a sequence", "an seq of Updates", "updates", "collection"],
    ["a camel-case type", "a DueDate", "dueDate", "named"],
  ])("names %s written without a name after its type", (_, field, name, kind) => {
    const parsed = parseSimpleStateForm(`a set of Questions with\n  ${field}`, {
      externalTypes: ["Profile", "Option", "Update", "DueDate"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([{ name, value: { kind } }]);
  });

  test("reads an explicit and an implied name the same way", () => {
    const implied = parseSimpleStateForm(
      `a set of Votes with\n  an Item\n  a Voter\n  unique item and voter`,
      { externalTypes: ["Item", "Voter"] },
    );
    const written = parseSimpleStateForm(
      `a set of Votes with\n  an item Item\n  a voter Voter\n  unique item and voter`,
      { externalTypes: ["Item", "Voter"] },
    );
    expect(implied.diagnostics).toEqual([]);
    const shape = (result: typeof implied) =>
      result.document.declarations[0]?.fields.map(({ name, optional, unique, value }) => ({
        name,
        optional,
        unique,
        kind: value.kind,
      }));
    expect(shape(implied)).toEqual(shape(written));
  });

  test("asks for written names when two unnamed fields share a type", () => {
    expect(
      parseSimpleStateForm(`a set of Reviews with\n  a User\n  a User`, {
        externalTypes: ["User"],
      }).diagnostics,
    ).toMatchObject([
      {
        code: "SSF_DUPLICATE_FIELD",
        span: { start: { line: 3, column: 5 } },
        suggestion:
          "Write a distinct name before each field of type `User`; a field written without a name is named `user`.",
      },
    ]);
  });

  test.each([
    ["Set", "a Set", "  a setValue Set"],
    ["Unique", "an optional Unique", "  an optional uniqueValue Unique"],
    ["Optional", "a unique Optional", "  a unique optionalValue Optional"],
    ["Set collection", "a optional set of Set", "  a setValue set of Set"],
  ])("repairs an unnamed %s field, whose implied name is reserved", (label, field, suggestion) => {
    const type = label.split(" ")[0]!;
    const parsed = parseSimpleStateForm(`a set of Things with\n  ${field}`, {
      externalTypes: [type],
    });
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_FIELD",
        message: expect.stringContaining("which the grammar reserves"),
        suggestion,
      },
    ]);
    expect(
      parseSimpleStateForm(`a set of Things with\n${suggestion}`, { externalTypes: [type] })
        .diagnostics,
    ).toEqual([]);
  });

  test("repairs a reserved implied name with a name no other field takes", () => {
    expect(
      parseSimpleStateForm("a set of Things with\n  a Set\n  a setValue String", {
        externalTypes: ["Set"],
      }).diagnostics,
    ).toMatchObject([{ code: "SSF_MALFORMED_FIELD", suggestion: "  a setValue2 Set" }]);
  });

  test("tells a unique field from a uniqueness line by the case of its word", () => {
    const parsed = parseSimpleStateForm(`a set of Accounts with\n  unique Email\n  unique email`, {
      externalTypes: ["Email"],
    });
    expect(parsed.diagnostics).toMatchObject([{ code: "SSF_DUPLICATE_UNIQUE" }]);
    expect(parsed.document.declarations[0]).toMatchObject({
      fields: [{ name: "email", unique: true }],
      constraints: [{ fields: ["email"] }],
    });
  });

  test("does not invent a name for an unnamed enumeration", () => {
    expect(
      parseSimpleStateForm(`a set of Questions with\n  a set of OPEN or DONE`).diagnostics,
    ).toMatchObject([
      { code: "SSF_MALFORMED_FIELD", suggestion: expect.not.stringContaining("dONE") },
    ]);
  });
});

describe("unique fields", () => {
  test("parses uniqueness on required and optional scalar fields", () => {
    const parsed = parseSimpleStateForm(`a set of Accounts with
  a unique handle String
  an optional unique email String`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { name: "handle", optional: false, unique: true },
      { name: "email", optional: true, unique: true },
    ]);
  });

  test("accepts the modifiers in either order under either article", () => {
    const parsed = parseSimpleStateForm(`a set of Accounts with
  a optional unique handle String
  an unique optional email String
  unique nickname String`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { name: "handle", optional: true, unique: true },
      { name: "email", optional: true, unique: true },
      { name: "nickname", optional: false, unique: true },
    ]);
  });

  test("rejects a repeated modifier", () => {
    expect(
      parseSimpleStateForm(`a set of Accounts with\n  a unique unique handle String`).diagnostics,
    ).toMatchObject([{ code: "SSF_MALFORMED_FIELD" }]);
  });

  test("records ordinary fields as non-unique", () => {
    const parsed = parseSimpleStateForm(`a set of Items with
  a title String`);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields[0]).toMatchObject({ unique: false });
  });

  test.each([
    ["unique after the field name", "a code unique String", "a unique code String"],
    ["unique after the value", "a code String unique", "a unique code String"],
    ["optional after the field name", "a code optional String", "a optional code String"],
  ])("diagnoses %s", (_, field, suggestion) => {
    const parsed = parseSimpleStateForm(`a set of Items with\n  ${field}`);
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_MISPLACED_MODIFIER", suggestion: `  ${suggestion}` },
    ]);
  });

  test("parses uniqueness on a collection field", () => {
    const parsed = parseSimpleStateForm(
      `a set of Teams with
  a unique members set of Person`,
      { externalTypes: ["Person"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields[0]).toMatchObject({
      name: "members",
      unique: true,
      value: { kind: "collection", multiplicity: "set" },
    });
  });
});

const CONSTRAINED = {
  externalTypes: ["Item", "Voter", "Direction", "Target", "Person", "Subject"],
} as const;

describe("unique combinations", () => {
  test("parses a constraint line over two or more fields", () => {
    const parsed = parseSimpleStateForm(
      `a set of Votes with
  an item Item
  a voter Voter
  a direction Direction
  unique item and voter
  unique item and voter and direction`,
      CONSTRAINED,
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.constraints).toMatchObject([
      { kind: "unique", fields: ["item", "voter"], span: { start: { line: 5 } } },
      { fields: ["item", "voter", "direction"] },
    ]);
    expect(parsed.document.declarations[0]?.fields.map(({ unique }) => unique)).toEqual([
      false,
      false,
      false,
    ]);
  });

  test("keeps a named value on the line a field", () => {
    const parsed = parseSimpleStateForm(
      `a set of Items with
  unique title String`,
      CONSTRAINED,
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]).toMatchObject({
      fields: [{ name: "title", unique: true }],
      constraints: [],
    });
  });

  test("names one field where a subset has no field of its own to modify", () => {
    const parsed = parseSimpleStateForm(
      `a set of Reviews with
  a subject Subject
  a status Status

a set of Pending Reviews where status is PENDING with
  unique subject`,
      { externalTypes: ["Subject"], localTypes: [{ name: "Status", values: ["PENDING", "DONE"] }] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[1]?.constraints).toMatchObject([{ fields: ["subject"] }]);
  });

  test.each([
    ["a missing separator", "unique item voter"],
    ["a trailing separator", "unique item and"],
    ["an uppercase name", "unique item and Voter"],
  ])("rejects %s", (_, constraint) => {
    expect(
      validateSimpleStateForm(
        `a set of Votes with\n  an item Item\n  ${constraint}`,
        CONSTRAINED,
      ).map(({ code }) => code),
    ).toEqual(["SSF_MALFORMED_FIELD"]);
  });

  test("reports a name that is not a field of the declaration", () => {
    expect(
      validateSimpleStateForm(
        `a set of Votes with\n  an item Item\n  unique item and voter`,
        CONSTRAINED,
      ),
    ).toMatchObject([
      {
        code: "SSF_UNKNOWN_UNIQUE_FIELD",
        message:
          'Uniqueness constraint names "voter", which is not a field of declaration "Votes".',
        span: { start: { line: 3, column: 19 } },
      },
    ]);
  });

  test("treats the modifier as the one-field line it stands for", () => {
    expect(
      validateSimpleStateForm(`a set of Items with\n  a unique item String\n  unique item`).map(
        ({ code }) => code,
      ),
    ).toEqual(["SSF_DUPLICATE_UNIQUE"]);
    expect(
      validateSimpleStateForm(
        `a set of Items with\n  a unique members seq of String\n  unique members`,
      ).map(({ code }) => code),
    ).toEqual(["SSF_DUPLICATE_UNIQUE"]);
  });

  test("reports a repeated name and a repeated combination", () => {
    expect(
      validateSimpleStateForm(
        `a set of Votes with
  an item Item
  a voter Voter
  unique item and item
  unique item and voter
  unique voter and item`,
        CONSTRAINED,
      ).map(({ code, message }) => [code, message]),
    ).toEqual([
      ["SSF_DUPLICATE_UNIQUE", 'Uniqueness constraint names field "item" more than once.'],
      [
        "SSF_DUPLICATE_UNIQUE",
        'Declaration "Votes" constrains the combination "item and voter" more than once.',
      ],
    ]);
  });

  test("resolves a subset constraint against its own and its ancestors' fields", () => {
    const parsed = parseSimpleStateForm(
      `a set of Invitations with
  a target Target
  an invitee Person

a set of Pending Invitations with
  a note String
  unique target and invitee
  unique target and note`,
      CONSTRAINED,
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[1]?.constraints).toHaveLength(2);
  });

  test("does not resolve a constraint against an unrelated declaration's fields", () => {
    expect(
      validateSimpleStateForm(
        `a set of Invitations with
  a target Target

a set of Reviews with
  a subject Subject
  unique subject and target`,
        CONSTRAINED,
      ).map(({ code }) => code),
    ).toEqual(["SSF_UNKNOWN_UNIQUE_FIELD"]);
  });

  test("accepts a constraint as a whole body, but still needs `with`", () => {
    expect(
      validateSimpleStateForm(`a set of Votes\n  unique item and voter`, CONSTRAINED).map(
        ({ code }) => code,
      ),
    ).toEqual(["SSF_MISSING_WITH", "SSF_UNKNOWN_UNIQUE_FIELD", "SSF_UNKNOWN_UNIQUE_FIELD"]);
    expect(
      validateSimpleStateForm(`a set of Votes with\n  unique item and voter`, CONSTRAINED).map(
        ({ code }) => code,
      ),
    ).toEqual(["SSF_UNKNOWN_UNIQUE_FIELD", "SSF_UNKNOWN_UNIQUE_FIELD"]);
  });

  test("reports an orphaned constraint as a constraint", () => {
    expect(validateSimpleStateForm("  unique item and voter")).toMatchObject([
      {
        code: "SSF_ORPHANED_LINE",
        message: "This valid SSF uniqueness constraint has no enclosing SSF declaration.",
      },
    ]);
  });
});

describe("collection fields", () => {
  test("parses named set and sequence elements with an optional collection `of`", () => {
    const parsed = parseSimpleStateForm(
      `a set of Palettes with
  a watchers set of Person
  a reviewers seq Person`,
      { externalTypes: ["Person"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        name: "watchers",
        value: {
          kind: "collection",
          multiplicity: "set",
          element: { reference: { text: "Person", referenceKind: "external" } },
        },
      },
      {
        name: "reviewers",
        value: {
          kind: "collection",
          multiplicity: "sequence",
          element: { reference: { text: "Person", referenceKind: "external" } },
        },
      },
    ]);
  });

  test.each([
    ["an inline enumeration", "a status of OPEN or DONE", 27],
    ["an inline collection enumeration", "a flags set of RED or BLUE", 29],
    ["a doubled collection `of`", "a flags set of of Person", 27],
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

  test.each([
    ["nested collections", "a tags set of set of String", 30],
    ["named-type unions", "a owner Person or Group", 26],
  ])("rejects %s as the only declaration field", (_, field, column) => {
    const parsed = parseSimpleStateForm(`a set of Items with
  ${field}`);
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_FIELD",
        message: "This indented line is not an SSF field, uniqueness constraint, or `Rule:` line.",
        suggestion:
          "Use a complete field, a `unique fieldName (and fieldName)*` constraint, or prefix prose with the exact `Rule:` marker.",
        span: {
          start: { line: 2, column: 1 },
          end: { line: 2, column },
        },
      },
    ]);
  });

  test("rejects a declaration ending in `with` without indented fields", () => {
    const parsed = parseSimpleStateForm("a set of Items with");
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_MALFORMED_DECLARATION",
        message:
          "A declaration ending in `with` must have at least one indented field or constraint.",
        suggestion: "Remove `with` or add an indented field or uniqueness constraint.",
        span: {
          start: { line: 1, column: 16 },
          end: { line: 1, column: 20 },
        },
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

    const external = parseSimpleStateForm("a set of Items", {
      externalTypes: ["Person"],
      evidenceTypeNames: ["Person"],
    });
    expect(ownedTypeNameSpellings(external.document.inventory)).toEqual(["Items"]);

    const primitive = parseSimpleStateForm("a set of Strings", {
      evidenceTypeNames: ["String"],
    });
    expect(ownedTypeNameSpellings(primitive.document.inventory)).toEqual(["Strings"]);
  });

  test("advises when one automatic candidate matches several owners", () => {
    const parsed = parseSimpleStateForm("a set of Ax\n\na set of Axis", {
      evidenceTypeNames: ["Axes"],
    });
    expect(parsed.diagnostics.filter(({ code }) => code !== "SSF_UNDECLARED_TYPE")).toMatchObject([
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
    expect(parsed.diagnostics.filter(({ code }) => code !== "SSF_UNDECLARED_TYPE")).toMatchObject([
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
    expect(parsed.diagnostics.filter(({ code }) => code !== "SSF_UNDECLARED_TYPE")).toMatchObject([
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
  a related Item

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

describe("qualified subsets", () => {
  const declared = (parsed: ReturnType<typeof parseSimpleStateForm>, name: string) =>
    parsed.document.declarations.find((declaration) => declaration.name.text === name);

  test.each([
    `a set of Leaf Branch Roots

a set of Branch Roots

a set of Roots`,
    `a set of Roots

a set of Leaf Branch Roots

a set of Branch Roots`,
  ])("chains qualifiers into subsets independent of declaration order", (source) => {
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual(["Roots"]);
    expect(declared(parsed, "Leaf Branch Roots")).toMatchObject({
      declarationKind: "subset",
      qualifier: "Leaf",
      name: { referenceKind: "subset", normalized: "Leaf Branch Roots" },
      parent: { text: "Branch Roots", normalized: "Branch Roots", referenceKind: "subset" },
    });
    expect(declared(parsed, "Branch Roots")).toMatchObject({
      qualifier: "Branch",
      parent: { text: "Roots", normalized: "Roots", referenceKind: "owned" },
    });
  });

  test("uses a subset as a field type in either number", () => {
    const parsed = parseSimpleStateForm(
      `a set of Users with
  a reputation Number

a set of Verified Users with
  a verifiedOn Date

a set of Vouches with
  a sponsor Verified User
  a candidate User
  a Verified User
  a set of Verified Users`,
      { externalTypes: ["User"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(declared(parsed, "Vouches")?.fields).toMatchObject([
      {
        name: "sponsor",
        value: { reference: { normalized: "Verified Users", referenceKind: "subset" } },
      },
      {
        name: "candidate",
        value: { reference: { normalized: "User", referenceKind: "external" } },
      },
      { name: "verifiedUser", value: { reference: { referenceKind: "subset" } } },
      { name: "verifiedUsers", value: { element: { reference: { referenceKind: "subset" } } } },
    ]);
    expect(parsed.document.inventory.subsets).toEqual([
      {
        name: "Verified Users",
        identifiers: ["VerifiedUser", "VerifiedUsers"],
        qualifierPrefix: "Verified",
        rootType: "User",
      },
    ]);
  });

  test("declares a singleton subset with an element", () => {
    const parsed = parseSimpleStateForm(
      "a set of Folders with\n  a name String\n\nan element Root Folder",
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(declared(parsed, "Root Folder")).toMatchObject({
      multiplicity: "element",
      qualifier: "Root",
      parent: { text: "Folder", normalized: "Folders", referenceKind: "owned" },
    });
  });

  test("reuses a qualifier across different sets", () => {
    const parsed = parseSimpleStateForm(
      "a set of Invitations\n\na set of Pending Invitations\n\na set of Pending Users",
      { externalTypes: ["User"] },
    );
    expect(parsed.diagnostics).toEqual([]);
  });

  test("rejects a qualifier repeated among the subsets of one set", () => {
    expect(
      parseSimpleStateForm(
        "a set of Users\n\na set of Trusted Users\n\na set of Verified Users\n\na set of Trusted Verified Users",
        { externalTypes: ["User"] },
      ).diagnostics,
    ).toMatchObject([
      {
        code: "SSF_REPEATED_QUALIFIER",
        message:
          'Qualifier "Trusted" already qualifies "Trusted Users"; a qualifier appears once among the subsets of one set.',
        span: { start: { line: 7, column: 10 } },
      },
    ]);
  });

  test("rejects a subset whose parent subset is not declared", () => {
    expect(
      parseSimpleStateForm("a set of Items\n\na set of Late Open Items").diagnostics,
    ).toMatchObject([
      {
        code: "SSF_INVALID_SUBSET_PARENT",
        message:
          'Subset "Late Open Items" qualifies "Open Items", which this State does not declare.',
        suggestion: "Declare `a set of Open Items`, or qualify a set that exists.",
      },
    ]);
  });

  test.each([
    ["a set of Open Missing", {}, "SSF_UNDECLARED_TYPE"],
    ["a set of Open String", {}, "SSF_INVALID_SUBSET_PARENT"],
    ["a set of Open Status", { localTypes: [{ name: "Status" }] }, "SSF_INVALID_SUBSET_PARENT"],
  ])("rejects %s", (source, options, code) => {
    const parsed = parseSimpleStateForm(source, options);
    expect(parsed.diagnostics).toMatchObject([{ code }]);
    expect(parsed.document.declarations[0]?.name.referenceKind).toBe("unresolved");
  });

  test("rejects a reference to a subset the State does not declare", () => {
    expect(
      parseSimpleStateForm("a set of Items\n\na set of Reviews with\n  an item Open Item")
        .diagnostics,
    ).toMatchObject([
      {
        code: "SSF_UNDECLARED_TYPE",
        message: 'Type "Open Item" is not a subset this State declares.',
        span: { start: { line: 4, column: 11 } },
      },
    ]);
  });

  test("rejects a subset declared twice and an identifier another type has", () => {
    const codesAndLines = (source: string) =>
      parseSimpleStateForm(source).diagnostics.map(({ code, span }) => [code, span?.start.line]);
    expect(codesAndLines("a set of Items\n\na set of Done Items\n\na set of Done Items")).toEqual([
      ["SSF_DUPLICATE_SET_NAME", 5],
    ]);
    expect(codesAndLines("a set of Items\n\na set of DoneItems\n\na set of Done Items")).toEqual([
      ["SSF_NAME_COLLISION", 5],
    ]);
  });

  test("resolves a subset's head through an explicit alias or an authored singular", () => {
    const aliased = parseSimpleStateForm(
      "a set of Roots\n\nalias Root for Roots\n\na set of Leaf Root",
    );
    expect(aliased.diagnostics).toEqual([]);
    expect(declared(aliased, "Leaf Root")?.parent).toMatchObject({ normalized: "Roots" });

    const joined = parseSimpleStateForm("a set of Items\n\nan element Current Item");
    expect(joined.diagnostics).toEqual([]);
    expect(joined.document.inventory.ownedTypeNames).toEqual(["Item", "Items"]);
    expect(joined.document.inventory.subsets).toMatchObject([
      { name: "Current Item", identifiers: ["CurrentItem", "CurrentItems"] },
    ]);
  });

  test("rejects a subset of a type with duplicate structural declarations", () => {
    const parsed = parseSimpleStateForm(
      "a set of Child Roots\n\na set of Roots\n\nan element Roots",
    );
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_INVALID_SUBSET_PARENT", span: { start: { line: 1, column: 10 } } },
      { code: "SSF_DUPLICATE_DECLARATION", span: { start: { line: 5, column: 12 } } },
    ]);
  });

  test.each([
    ["a seq of Late Items", ["SSF_MALFORMED_DECLARATION"]],
    ["a sequence of Late Items", ["SSF_MALFORMED_DECLARATION"]],
    ["seq of Late Items", ["SSF_ARTICLE", "SSF_MALFORMED_DECLARATION"]],
  ])("repairs the subset %s to one `set` declaration", (line, codes) => {
    const diagnostics = parseSimpleStateForm(`a set of Items\n\n${line}`).diagnostics;
    expect(diagnostics.map(({ code }) => code)).toEqual(codes);
    for (const { suggestion } of diagnostics) expect(suggestion).toBe("a set of Late Items");
  });

  test.each([
    ["an Open set of Items", "a set of Open Items"],
    ["an open set of Items where status is OPEN", "a set of Open Items where status is OPEN"],
    ["a late set of open Items", "a set of Late Open Items"],
    ["a Current element of Items", "an element Current Items"],
  ])("repairs the separately named subset %s", (line, suggestion) => {
    const parsed = parseSimpleStateForm(
      `a set of Items with\n  a status Status\n\na set of Open Items where status is OPEN\n\n${line}`,
      { localTypes: [{ name: "Status", values: ["OPEN", "DONE"] }] },
    );
    expect(
      parsed.diagnostics.find(({ code }) => code === "SSF_MALFORMED_DECLARATION"),
    ).toMatchObject({
      message:
        "Name a subset by qualifying its parent set, as in `a set of Verified Users`, rather than with a separate subset name.",
      suggestion,
    });
  });

  test("advises when a field is named like a qualifier", () => {
    expect(
      parseSimpleStateForm(
        "a set of Users\n\na set of Verified Users\n\na set of Vouches with\n  a verified User",
        { externalTypes: ["User"] },
      ).diagnostics,
    ).toMatchObject([
      {
        severity: "advice",
        code: "SSF_QUALIFIER_FIELD_NAME",
        suggestion:
          'If it holds members of "Verified Users", write `a Verified User`; otherwise give it a role name that is not a qualifier.',
        span: { start: { line: 6, column: 5 } },
      },
    ]);
  });

  test.each([
    ["a regular plural", "a set of Users\n\na set of VerifiedUser\n\na set of Verified Users"],
    ["an irregular plural", "a set of People\n\na set of ActivePerson\n\na set of Active People"],
    ["another irregular plural", "a set of Mice\n\na set of LabMouse\n\na set of Lab Mice"],
  ])("matches a subset's identifier in either number with %s", (_, source) => {
    expect(parseSimpleStateForm(source).diagnostics).toMatchObject([
      { code: "SSF_NAME_COLLISION", span: { start: { line: 5 } } },
    ]);
  });

  test("names an owned root by its declaration when several singulars are authored", () => {
    const aliases = ["alias Ax for Axes", "alias Axis for Axes"];
    const rootTypes = [aliases, aliases.toReversed()].map(
      (order) =>
        parseSimpleStateForm(`a set of Axes\n\n${order.join("\n\n")}\n\na set of Open Axes`)
          .document.inventory.subsets[0]?.rootType,
    );
    expect(rootTypes).toEqual(["Axes", "Axes"]);
  });

  test.each([
    ["an element", "an element Settings\n\na set of Active Settings"],
    [
      "an alias for an element",
      "an element Settings\n\nalias Config for Settings\n\na set of Active Config",
    ],
    [
      "an element subset",
      "a set of Folders\n\nan element Root Folder\n\na set of Open Root Folder",
    ],
  ])("rejects a subset of %s", (_, source) => {
    expect(parseSimpleStateForm(source).diagnostics).toMatchObject([
      {
        code: "SSF_INVALID_SUBSET_PARENT",
        message: expect.stringContaining(
          "which has one member; a subset qualifies a set or a sequence",
        ),
      },
    ]);
  });

  test("spans a subset's parent over the parent's own words", () => {
    const source = "a set of Users\r\na set of Trusted Users\r\nan element Active Trusted User";
    const parents = parseSimpleStateForm(source).document.declarations.flatMap(({ parent }) =>
      parent === undefined
        ? []
        : [[parent.text, source.slice(parent.span.start.offset, parent.span.end.offset)]],
    );
    expect(parents).toEqual([
      ["Users", "Users"],
      ["Trusted User", "Trusted User"],
    ]);
  });

  test.each([
    [
      "a nested subset",
      "  a trusted Verified User",
      'If it holds members of "Trusted Verified Users", write `a Trusted Verified User`; otherwise give it a role name that is not a qualifier.',
    ],
    [
      "a collection",
      "  a verified set of User",
      'If it holds members of "Verified Users", write `a set of Verified User`; otherwise give it a role name that is not a qualifier.',
    ],
    [
      "a field with modifiers",
      "  an optional unique verified User",
      'If it holds members of "Verified Users", write `an optional unique Verified User`; otherwise give it a role name that is not a qualifier.',
    ],
    [
      "a type no subset qualifies",
      "  a verified Number",
      "Give the field a role name that is not a qualifier.",
    ],
  ])("advises a valid repair for a field named like a qualifier on %s", (_, field, suggestion) => {
    expect(
      parseSimpleStateForm(
        `a set of Users\n\na set of Verified Users\n\na set of Trusted Verified Users\n\na set of Teams with\n${field}`,
      ).diagnostics,
    ).toMatchObject([{ severity: "advice", code: "SSF_QUALIFIER_FIELD_NAME", suggestion }]);
  });

  describe("subset conditions", () => {
    const localTypes = [
      { name: "Status", values: ["OPEN", "DONE"] },
      { name: "Level", values: ["LOW", "HIGH"] },
    ];
    const tickets = "a set of Tickets with\n  a status Status\n  a title String\n\n";

    test("resolve a condition against the fields of every ancestor, in any order", () => {
      const source = [
        "a set of Critical Urgent Open Tickets where level is HIGH",
        "a set of Urgent Open Tickets with\r\n  a level Level",
        "a set of Open Tickets where status is OPEN",
        "a set of Tickets with\r\n  a status Status",
      ].join("\r\n\r\n");
      expect(parseSimpleStateForm(source, { localTypes }).diagnostics).toEqual([]);
    });

    test.each([
      [
        "a missing field",
        "a set of Open Tickets where state is OPEN",
        'Subset condition names "state", which is not a field of "Open Tickets" or of a set it is a subset of.',
        29,
      ],
      [
        "a field that is not an enumeration",
        "a set of Titled Tickets where title is OPEN",
        'Subset condition tests field "title", whose type "String" is not a declared enumeration.',
        31,
      ],
      [
        "an unknown value",
        "a set of Open Tickets where status is CLOSED",
        'Subset condition tests for "CLOSED", which is not a value of "Status".',
        39,
      ],
      [
        "a repeated value",
        "a set of Open Tickets where status is OPEN or OPEN",
        'Subset condition tests for "OPEN" more than once.',
        47,
      ],
    ])("reject %s", (_, line, message, column) => {
      expect(parseSimpleStateForm(`${tickets}${line}`, { localTypes }).diagnostics).toMatchObject([
        { code: "SSF_INVALID_SUBSET_CONDITION", message, span: { start: { line: 5, column } } },
      ]);
    });
  });
});

describe("sets of external types", () => {
  test("reads a set named for an external type's plural as a set of that type", () => {
    const parsed = parseSimpleStateForm(
      `a set of Users with
  an Account

a set of Banned Users

a set of Rejected Banned Users`,
      { externalTypes: ["User", "Account"] },
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory).toMatchObject({
      ownedTypeNames: [],
      external: ["Account", "User"],
      externalSpellings: ["Users"],
    });
    expect(parsed.document.declarations).toMatchObject([
      {
        declarationKind: "collection",
        name: { text: "Users", normalized: "User", referenceKind: "external" },
        fields: [{ name: "account", value: { reference: { referenceKind: "external" } } }],
      },
      { parent: { text: "Users", normalized: "User", referenceKind: "external" } },
      { parent: { text: "Banned Users", normalized: "Banned Users", referenceKind: "subset" } },
    ]);
  });

  test("qualifies an external type the concept declares no set of", () => {
    const parsed = parseSimpleStateForm("a set of Read Posts\n\na set of Starred Read Posts", {
      externalTypes: ["Post"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toMatchObject([
      {
        qualifier: "Read",
        parent: { text: "Posts", normalized: "Post", referenceKind: "external" },
      },
      { qualifier: "Starred", parent: { text: "Read Posts", referenceKind: "subset" } },
    ]);
  });

  test("rejects a set named exactly for an external type", () => {
    expect(
      parseSimpleStateForm("a set of User", { externalTypes: ["User"] }).diagnostics,
    ).toMatchObject([
      {
        code: "SSF_NAME_COLLISION",
        suggestion: expect.stringContaining("Write the plural, `Users`,"),
      },
    ]);
  });

  test("joins an authored plural of an external type in a field or signature", () => {
    const parsed = parseSimpleStateForm("a set of Items with\n  a set of Tags", {
      externalTypes: ["Tag", "Person"],
      evidenceTypeNames: ["People"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        name: "tags",
        value: {
          element: { reference: { text: "Tags", normalized: "Tag", referenceKind: "external" } },
        },
      },
    ]);
    expect(parsed.document.inventory.externalSpellings).toEqual(["People", "Tags"]);
    expect(parsed.document.inventory.ownedTypeNames).toEqual(["Items"]);
  });

  test("recognizes a set of an external type only by that type's plural", () => {
    const backwards = parseSimpleStateForm("a set of User", { externalTypes: ["Users"] });
    expect(backwards.diagnostics).toEqual([]);
    expect(backwards.document.inventory).toMatchObject({
      ownedTypeNames: ["User"],
      externalSpellings: [],
    });

    const roots = ["a set of Ax with\n  a status Status", "a set of Axis with\n  a radius Number"];
    const outcomes = [roots, roots.toReversed()].map((order) => {
      const parsed = parseSimpleStateForm(
        `${order.join("\n\n")}\n\na set of Open Axes where status is OPEN`,
        { externalTypes: ["Axes"], localTypes: [{ name: "Status", values: ["OPEN", "DONE"] }] },
      );
      return [parsed.document.inventory.ownedTypeNames, parsed.diagnostics.map(({ code }) => code)];
    });
    expect(outcomes[0]).toEqual([["Ax", "Axis"], ["SSF_INVALID_SUBSET_CONDITION"]]);
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  test("suggests a rename for an external type spelled the same in the plural", () => {
    expect(
      parseSimpleStateForm("a set of Series", { externalTypes: ["Series"] }).diagnostics,
    ).toMatchObject([
      {
        code: "SSF_NAME_COLLISION",
        suggestion:
          "`Series` is spelled the same in the plural, so rename the external type (for example `SeriesItem`, declared as `a set of SeriesItems`), or declare a qualified subset such as `a set of Tracked Series`.",
      },
    ]);
    expect(
      parseSimpleStateForm("a set of Tracked Series", { externalTypes: ["Series"] }).diagnostics,
    ).toEqual([]);
  });

  test("advises exact external names, not aliases, when an external spelling is ambiguous", () => {
    expect(
      parseSimpleStateForm("a set of Items with\n  an axis Axes", {
        externalTypes: ["Ax", "Axis"],
      }).diagnostics.find(({ code }) => code === "SSF_AMBIGUOUS_AUTOMATIC_ALIAS"),
    ).toMatchObject({
      severity: "advice",
      externalType: "Ax",
      suggestion:
        "Write the exact external type name, or rename a type so each spelling pairs with only one.",
    });
  });

  test("keeps an element named like an external plural as an owned element", () => {
    const parsed = parseSimpleStateForm("an element Users with\n  a count Number", {
      externalTypes: ["User"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.inventory.ownedTypeNames).toEqual(["Users"]);
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

  test("rejects duplicate field names only within a declaration", () => {
    const parsed = parseSimpleStateForm(`a set of First with
  a profile String
  a profile String

a set of Second with
  a profile String`);
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_DUPLICATE_FIELD", span: { start: { line: 3 } } },
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

  test("rejects a declaration that collides with a concept-local type", () => {
    const parsed = parseSimpleStateForm("a set of Statuses with\n  a name String", {
      localTypes: [{ name: "Statuses", values: ["OPEN", "DONE"] }],
    });
    expect(parsed.diagnostics).toMatchObject([
      {
        code: "SSF_NAME_COLLISION",
        message: 'Structural declaration "Statuses" collides with a concept-local type.',
      },
    ]);
    expect(parsed.document.declarations[0]?.name.referenceKind).toBe("local");
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([]);
  });

  test("keeps a concept-local name out of the automatic alias inventory", () => {
    const source = "a set of Items";
    const evidenceTypeNames = ["Item"];
    expect(
      ownedTypeNameSpellings(
        parseSimpleStateForm(source, { evidenceTypeNames }).document.inventory,
      ),
    ).toEqual(["Item", "Items"]);
    // Declaring `Item` locally takes the spelling, so the plural join must not also claim
    // it; otherwise one name would be both owned and concept-local.
    expect(
      ownedTypeNameSpellings(
        parseSimpleStateForm(source, { evidenceTypeNames, localTypes: [{ name: "Item" }] }).document
          .inventory,
      ),
    ).toEqual(["Items"]);
  });

  test("keeps an alias out of the concept-local namespace", () => {
    expect(
      parseSimpleStateForm("a set of Items with\n  a name String\n\nalias Status for Items", {
        localTypes: [{ name: "Status", values: ["OPEN", "DONE"] }],
      }).diagnostics,
    ).toMatchObject([{ code: "SSF_ALIAS_NAME_COLLISION" }]);
  });

  test.each([
    ["a set of Pending Status", "SSF_INVALID_SUBSET_PARENT", 'qualifies "Status", which is'],
    ["alias State for Status", "SSF_INVALID_ALIAS_TARGET", 'Alias target "Status" is'],
  ])("identifies a concept-local structural target: %s", (source, code, subject) => {
    expect(
      parseSimpleStateForm(source, { localTypes: [{ name: "Status" }] }).diagnostics,
    ).toMatchObject([
      {
        code,
        message: expect.stringContaining(`${subject} a concept-local type;`),
      },
    ]);
  });

  test("rejects an alias for a set of an external type", () => {
    expect(
      parseSimpleStateForm("a set of Users\n\nalias Member for Users", {
        externalTypes: ["User"],
      }).diagnostics,
    ).toMatchObject([
      {
        code: "SSF_INVALID_ALIAS_TARGET",
        message: expect.stringContaining('"Users" is a set of an external type;'),
      },
    ]);
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
    expect(validateSimpleStateForm(source, { externalTypes: ["Person"] })).toMatchObject([
      { code: "SSF_NEAR_MISS_KEYWORD", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISSING_WITH", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISPLACED_MODIFIER", suggestion: "  a optional revokedAt DateTime" },
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
      resolve(root, "packages/skill/skills/sync-engine/prompts/guidance/design/ssf.md"),
      "utf8",
    );
    const parsed = parseSimpleStateForm(stateFence(markdown), {
      externalTypes: ["Person", "Voter", "Update"],
      localTypes: [{ name: "Status", values: ["OPEN", "DONE"] }],
      evidenceTypeNames: ["Item"],
    });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toMatchObject([
      {
        name: { text: "Items", referenceKind: "owned" },
        fields: [
          { name: "title", unique: true, value: { kind: "named" } },
          {
            name: "item",
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
          { name: "watchers", value: { kind: "collection", multiplicity: "set" } },
          {
            name: "updates",
            value: {
              kind: "collection",
              multiplicity: "sequence",
              element: { reference: { text: "Update", referenceKind: "external" } },
            },
          },
          { name: "status", value: { reference: { text: "Status", referenceKind: "local" } } },
        ],
      },
      {
        name: { text: "Votes", referenceKind: "owned" },
        fields: [
          { name: "item", value: { reference: { text: "Item", normalized: "Items" } } },
          { name: "voter", value: { reference: { referenceKind: "external" } } },
        ],
        constraints: [{ kind: "unique", fields: ["item", "voter"] }],
      },
      {
        name: { text: "Completed Items", referenceKind: "subset" },
        declarationKind: "subset",
        qualifier: "Completed",
        parent: { text: "Items", referenceKind: "owned" },
        condition: { field: "status", values: ["DONE"] },
        fields: [{ name: "completedAt" }],
      },
      {
        name: { text: "Reviews", referenceKind: "owned" },
        fields: [
          {
            name: "completedItem",
            value: { reference: { normalized: "Completed Items", referenceKind: "subset" } },
          },
          { name: "reviewer", value: { reference: { referenceKind: "external" } } },
        ],
      },
      {
        name: { text: "Muted People", referenceKind: "subset" },
        qualifier: "Muted",
        parent: { text: "People", normalized: "Person", referenceKind: "external" },
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
    expect(parsed.document.rules).toMatchObject([{ text: "Rule: an Item's owner must be active" }]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Item",
      "Items",
      "Reviews",
      "Settings",
      "Votes",
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
        localTypes: localTypes(markdown),
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
