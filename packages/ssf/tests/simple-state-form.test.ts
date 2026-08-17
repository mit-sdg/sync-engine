import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isOwnedTypeName,
  normalizeTypeName,
  ownedTypeNameSpellings,
  parseSimpleStateForm,
  tokenizeSimpleStateForm,
  typeNamesEquivalent,
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

describe("SSF tokenization and spans", () => {
  test("retains every token and reports one-based lines with zero-based offsets", () => {
    const source = "a set of Items with\r\n  a title String";
    const tokens = tokenizeSimpleStateForm(source);
    expect(tokens.map(({ kind, text }) => [kind, text])).toContainEqual(["newline", "\r\n"]);
    expect(tokens.filter(({ kind }) => kind === "word").at(-1)).toMatchObject({
      text: "String",
      span: {
        start: { offset: 31, line: 2, column: 11 },
        end: { offset: 37, line: 2, column: 17 },
      },
    });
    expect(tokens.map(({ text }) => text).join("")).toBe(source);
  });
});

describe("structural SSF parsing", () => {
  test("parses collections, elements, subsets, fields, references, and opaque invariants", () => {
    const source = `a set of Items with
  a title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

an element Settings with
  a retentionDays Number

an Open set of Items

at most one Item has each title`;
    const parsed = parseSimpleStateForm(source, { externalTypes: ["Person"] });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toHaveLength(3);
    expect(parsed.document.declarations[0]).toMatchObject({
      name: { text: "Items", normalized: "Item", referenceKind: "owned" },
      declarationKind: "collection",
      multiplicity: "set",
      fields: [
        {
          name: "title",
          value: {
            kind: "named",
            reference: { text: "String", referenceKind: "primitive" },
          },
        },
        {
          name: "owner",
          optional: true,
          value: {
            kind: "named",
            reference: { text: "Person", referenceKind: "external" },
          },
        },
        {
          name: "watchers",
          value: {
            kind: "collection",
            multiplicity: "set",
            element: {
              kind: "named",
              reference: { text: "Person", referenceKind: "external" },
            },
          },
        },
        {
          name: "status",
          value: { kind: "enumeration", values: ["OPEN", "DONE"] },
        },
      ],
    });
    expect(parsed.document.declarations[1]).toMatchObject({
      name: { text: "Settings", normalized: "Settings", referenceKind: "owned" },
      multiplicity: "element",
    });
    expect(parsed.document.declarations[2]).toMatchObject({
      name: { text: "Open", normalized: "Open", referenceKind: "owned" },
      declarationKind: "subset",
      parent: { text: "Items", normalized: "Item", referenceKind: "owned" },
    });
    expect(parsed.document.opaqueLines).toMatchObject([
      { kind: "opaque", text: "at most one Item has each title" },
    ]);
    expect(parsed.document.inventory).toMatchObject({
      identities: [{ name: "Item" }, { name: "Settings" }],
      types: [{ name: "Item" }, { name: "Open" }, { name: "Settings" }],
      external: ["Person"],
    });
    expect(isOwnedTypeName(parsed.document.inventory, "Items")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Item")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Person")).toBe(false);
    expect(isOwnedTypeName(parsed.document.inventory, "Settings")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Setting")).toBe(false);
    expect(isOwnedTypeName(parsed.document.inventory, "Itme")).toBe(false);
  });

  test("inventories non-external structural field types as owned vocabulary", () => {
    const parsed = parseSimpleStateForm(
      "a set of Accounts with\n  a username Username\n  a aliases set of Alias",
    );
    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Account", roles: ["identity"] },
      { name: "Alias", roles: [] },
      { name: "Username", roles: [] },
    ]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { value: { reference: { referenceKind: "owned" } } },
      { value: { element: { reference: { referenceKind: "owned" } } } },
    ]);
  });

  test("does not claim external or primitive collection subjects as owned types", () => {
    const parsed = parseSimpleStateForm(
      "a set of People\n\na set of Strings\n\na Local set of People",
      { externalTypes: ["People"] },
    );
    expect(parsed.document.declarations.map(({ name }) => name.referenceKind)).toEqual([
      "external",
      "primitive",
      "owned",
    ]);
    expect(parsed.document.inventory.types.map(({ name }) => name)).toEqual(["Local"]);
  });

  test("infers omitted scalar and collection field names", () => {
    const { document } = parseSimpleStateForm(
      "a set of Questions with\n  a Profile\n  a set of Options",
    );
    expect(document.declarations[0]?.fields).toMatchObject([
      { name: "profile", inferredName: true },
      { name: "options", inferredName: true },
    ]);
  });
});

describe("type-name normalization", () => {
  test("uses structural kind and never invents names from singular elements ending in s", () => {
    const parsed = parseSimpleStateForm(`an element Canvas

an element Gas

an element Lens

an element Mouse

a set of Canvases

a set of Gases

a set of Lenses

a set of Mice`);
    expect(parsed.document.inventory.types.map(({ name }) => name)).toEqual([
      "Canvas",
      "Gas",
      "Lens",
      "Mouse",
    ]);
    expect(parsed.document.inventory.types.flatMap(({ declaredNames }) => declaredNames)).toEqual([
      "Canvas",
      "Canvases",
      "Gas",
      "Gases",
      "Lens",
      "Lenses",
      "Mouse",
      "Mice",
    ]);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Canvas",
      "Canvases",
      "Gas",
      "Gases",
      "Lens",
      "Lenses",
      "Mice",
      "Mouse",
    ]);
    for (const invented of ["Canva", "Ga", "Len"]) {
      expect(isOwnedTypeName(parsed.document.inventory, invented), invented).toBe(false);
    }
    expect(typeNamesEquivalent("Mouse", "Mice")).toBe(true);
    expect(typeNamesEquivalent("Canvas", "Canva")).toBe(false);
    expect(typeNamesEquivalent("Gas", "Ga")).toBe(false);
    expect(typeNamesEquivalent("Lens", "Len")).toBe(false);
  });

  test("enumerates canonical, regular, exceptional, authored, and subset spellings", () => {
    const inventory = parseSimpleStateForm(
      "an element Entry\n\nan element Person\n\nan Analysis set of Entries",
    ).document.inventory;
    expect(ownedTypeNameSpellings(inventory)).toEqual([
      "Analyses",
      "Analysis",
      "Entries",
      "Entry",
      "People",
      "Person",
    ]);
    expect(
      ownedTypeNameSpellings(inventory).every((name) => isOwnedTypeName(inventory, name)),
    ).toBe(true);
  });

  test.each([
    ["Items", "Item"],
    ["Entries", "Entry"],
    ["Addresses", "Address"],
    ["Statuses", "Status"],
    ["Settings", "Setting"],
    ["Status", "Status"],
    ["Alias", "Alias"],
    ["Aliases", "Alias"],
    ["Analysis", "Analysis"],
    ["News", "News"],
    ["Series", "Series"],
  ])("normalizes %s to %s", (authored, normalized) => {
    expect(normalizeTypeName(authored)).toBe(normalized);
    expect(typeNamesEquivalent(authored, normalized)).toBe(true);
  });
});

describe("canonical repair diagnostics", () => {
  test("diagnoses structural-looking malformed lines while retaining invariant prose as opaque", () => {
    const source = `set Items

a set of Records with garbage

a set of Accounts with
  a owner

at most one Item has each owner`;
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics).toMatchObject([
      { code: "SSF_ARTICLE" },
      { code: "SSF_MALFORMED_DECLARATION" },
      { code: "SSF_MALFORMED_FIELD" },
    ]);
    expect(parsed.document.opaqueLines.map(({ text }) => text)).toEqual([
      "a set of Records with garbage",
      "  a owner",
      "at most one Item has each owner",
    ]);
  });

  test("uses the parser's recovered structure for every existing repair", () => {
    const source = `a sequence of Sessions
  a revokedAt optional DateTime

a set of Groups with
  an optional members seq of Person

a element Settings with`;
    expect(validateSimpleStateForm(source)).toMatchObject([
      { code: "SSF_NEAR_MISS_KEYWORD", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISSING_WITH", suggestion: "a seq of Sessions with" },
      { code: "SSF_MISPLACED_OPTIONAL", suggestion: "an optional revokedAt DateTime" },
      { code: "SSF_OPTIONAL_COLLECTION", suggestion: "Remove `optional` from this field." },
      { code: "SSF_ARTICLE", suggestion: "an element Settings with" },
    ]);
    expect(
      parseSimpleStateForm(source).document.inventory.identities.map(({ name }) => name),
    ).toEqual(["Group", "Session", "Settings"]);
  });
});

describe("repository SSF corpus", () => {
  test("extracts owned identities from every catalog and application concept specification", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const expected: Readonly<Record<string, readonly string[]>> = {
      "packages/catalog/entries/concept/alerting/spec.md": ["Alert"],
      "packages/catalog/entries/concept/approving/spec.md": ["Review"],
      "packages/catalog/entries/concept/auditing/spec.md": ["Entry"],
      "packages/catalog/entries/concept/authenticating/spec.md": ["Account"],
      "packages/catalog/entries/concept/commenting/spec.md": ["Comment"],
      "packages/catalog/entries/concept/discussing/spec.md": ["Discussion", "Response"],
      "packages/catalog/entries/concept/gathering/spec.md": ["Gathering", "Membership"],
      "packages/catalog/entries/concept/inviting/spec.md": ["Invitation"],
      "packages/catalog/entries/concept/labeling/spec.md": ["Application", "Label"],
      "packages/catalog/entries/concept/posting/spec.md": ["Post"],
      "packages/catalog/entries/concept/reserving/spec.md": ["Reservation"],
      "packages/catalog/entries/concept/selecting/spec.md": ["Current", "Selection"],
      "packages/catalog/entries/concept/sessioning/spec.md": ["Session"],
      "packages/catalog/entries/concept/timing/spec.md": [],
      "packages/catalog/entries/concept/trashing/spec.md": ["Disposition"],
      "packages/catalog/entries/concept/upvoting/spec.md": ["Vote"],
      "examples/message-board/design/concepts/Authenticating.md": ["Account"],
      "examples/message-board/design/concepts/Commenting.md": ["Comment"],
      "examples/message-board/design/concepts/Posting.md": ["Post"],
      "examples/message-board/design/concepts/Sessioning.md": ["Session"],
      "examples/operations-room/design/concepts/Alerting.md": ["Alert"],
      "examples/operations-room/design/concepts/Discussing.md": ["Discussion", "Open", "Response"],
      "examples/operations-room/design/concepts/Gathering.md": ["Gathering", "Membership"],
      "examples/operations-room/design/concepts/Selecting.md": ["Current", "Selection"],
      "examples/reading-circle/design/concepts/Discussing.md": ["Discussion", "Open", "Response"],
      "examples/reading-circle/design/concepts/Gathering.md": ["Gathering", "Membership"],
      "examples/reading-circle/design/concepts/Selecting.md": ["Current", "Selection"],
      "tests/packaging/application/src/concepts/mitigating/spec.md": ["Current", "Selection"],
      "tests/packaging/application/src/concepts/rooming/spec.md": ["Room"],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Effects.md": [
        "Observation",
      ],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Entries.md": ["Entry"],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Faulting.md": [],
    };

    for (const [path, names] of Object.entries(expected)) {
      const markdown = await readFile(resolve(root, path), "utf8");
      const parsed = parseSimpleStateForm(stateFence(markdown), {
        externalTypes: externalTypes(markdown),
      });
      expect(parsed.diagnostics, path).toEqual([]);
      expect(
        parsed.document.inventory.types.some(({ name }) => ["Canva", "Ga", "Len"].includes(name)),
        path,
      ).toBe(false);
      expect(
        ownedTypeNameSpellings(parsed.document.inventory).every((name) =>
          isOwnedTypeName(parsed.document.inventory, name),
        ),
        path,
      ).toBe(true);
      expect(
        parsed.document.inventory.types
          .filter(({ roles }) => roles.length > 0)
          .map(({ name }) => name),
        path,
      ).toEqual([...names].sort());
    }
  });
});
