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
    const parsed = parseSimpleStateForm(source, {
      externalTypes: ["Person"],
      evidenceTypeNames: ["Item"],
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.declarations).toHaveLength(3);
    expect(parsed.document.declarations[0]).toMatchObject({
      name: { text: "Items", normalized: "Items", referenceKind: "owned" },
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
      parent: { text: "Items", normalized: "Items", referenceKind: "owned" },
    });
    expect(parsed.document.opaqueLines).toMatchObject([
      { kind: "opaque", text: "at most one Item has each title" },
    ]);
    expect(parsed.document.inventory).toMatchObject({
      identities: [{ name: "Items", declaredNames: ["Item", "Items"] }, { name: "Settings" }],
      types: [
        { name: "Items", declaredNames: ["Item", "Items"] },
        { name: "Open" },
        { name: "Settings" },
      ],
      external: ["Person"],
    });
    expect(isOwnedTypeName(parsed.document.inventory, "Items")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Item")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Person")).toBe(false);
    expect(isOwnedTypeName(parsed.document.inventory, "Settings")).toBe(true);
    expect(isOwnedTypeName(parsed.document.inventory, "Setting")).toBe(false);
    expect(isOwnedTypeName(parsed.document.inventory, "Itme")).toBe(false);
  });

  test("uses field types only as evidence for a matching structural declaration", () => {
    const parsed = parseSimpleStateForm(
      "a set of Accounts with\n  an account Account\n  a username Username\n  a aliases set of Alias",
    );
    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Accounts", declaredNames: ["Account", "Accounts"], roles: ["identity"] },
    ]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { value: { reference: { referenceKind: "owned", normalized: "Accounts" } } },
      { value: { reference: { referenceKind: "unresolved" } } },
      { value: { element: { reference: { referenceKind: "unresolved" } } } },
    ]);
  });

  test("does not claim external or primitive collection subjects as owned types", () => {
    const parsed = parseSimpleStateForm(
      "a set of People\n\na set of Strings\n\na Local set of People",
      { externalTypes: ["People"] },
    );
    expect(parsed.document.declarations.map(({ name }) => name.referenceKind)).toEqual([
      "external",
      "owned",
      "owned",
    ]);
    expect(parsed.document.inventory.types.map(({ name }) => name)).toEqual(["Local", "Strings"]);
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

describe("evidence-based type-name equivalence", () => {
  test("never invents aliases for adversarial collection names", () => {
    const parsed = parseSimpleStateForm(`a set of Chaoses

a set of Atlases

a set of Biases

a set of Buses

a set of Canvases

a set of Gases

a set of Lenses

a set of Mice`);
    expect(ownedTypeNameSpellings(parsed.document.inventory)).toEqual([
      "Atlases",
      "Biases",
      "Buses",
      "Canvases",
      "Chaoses",
      "Gases",
      "Lenses",
      "Mice",
    ]);
    for (const invented of ["Atlase", "Biase", "Buse", "Canva", "Chaose", "Ga", "Len"]) {
      expect(isOwnedTypeName(parsed.document.inventory, invented), invented).toBe(false);
    }
  });

  test("admits only exact singular/plural candidates evidenced elsewhere", () => {
    const inventory = parseSimpleStateForm(
      `a set of Chaoses

a set of Atlases

a set of Biases

a set of Buses

a set of Mice`,
      { evidenceTypeNames: ["Chaos", "Atlas", "Bias", "Bus", "Mouse"] },
    ).document.inventory;
    expect(ownedTypeNameSpellings(inventory)).toEqual([
      "Atlas",
      "Atlases",
      "Bias",
      "Biases",
      "Bus",
      "Buses",
      "Chaos",
      "Chaoses",
      "Mice",
      "Mouse",
    ]);
    expect(inventory.types).toMatchObject([
      { name: "Atlases", declaredNames: ["Atlas", "Atlases"] },
      { name: "Biases", declaredNames: ["Bias", "Biases"] },
      { name: "Buses", declaredNames: ["Bus", "Buses"] },
      { name: "Chaoses", declaredNames: ["Chaos", "Chaoses"] },
      { name: "Mice", declaredNames: ["Mice", "Mouse"] },
    ]);
  });

  test("keeps element declarations exact even when another spelling is evidenced", () => {
    const inventory = parseSimpleStateForm(
      "an element Settings\n\nan element Canvas\n\nan element Mouse",
      { evidenceTypeNames: ["Setting", "Canvases", "Mice"] },
    ).document.inventory;
    expect(ownedTypeNameSpellings(inventory)).toEqual(["Canvas", "Mouse", "Settings"]);
    for (const rejected of ["Setting", "Canvases", "Mice"]) {
      expect(isOwnedTypeName(inventory, rejected), rejected).toBe(false);
    }
  });

  test.each([
    ["Items", "Item", true],
    ["Entries", "Entry", true],
    ["Addresses", "Address", true],
    ["Settings", "Setting", true],
    ["Chaoses", "Chaos", true],
    ["Atlases", "Atlas", true],
    ["Biases", "Bias", true],
    ["Bonuses", "Bonus", true],
    ["Buses", "Bus", true],
    ["Campuses", "Campus", true],
    ["Cosmoses", "Cosmos", true],
    ["Ethoses", "Ethos", true],
    ["Viruses", "Virus", true],
    ["Aliases", "Alias", true],
    ["Analyses", "Analysis", true],
    ["Canvases", "Canvas", true],
    ["Children", "Child", true],
    ["Feet", "Foot", true],
    ["Gases", "Gas", true],
    ["Geese", "Goose", true],
    ["Indices", "Index", true],
    ["Lenses", "Lens", true],
    ["Men", "Man", true],
    ["Matrices", "Matrix", true],
    ["Mice", "Mouse", true],
    ["People", "Person", true],
    ["Statuses", "Status", true],
    ["Teeth", "Tooth", true],
    ["Women", "Woman", true],
    ["Corpora", "Corpus", true],
    ["Cacti", "Cactus", true],
    ["Criteria", "Criterion", true],
    ["Wugs", "Wug", true],
    ["Parties", "Party", true],
    ["Boxes", "Box", true],
    ["Chaos", "Chao", false],
    ["Atlas", "Atla", false],
    ["Bias", "Bia", false],
    ["Bonus", "Bonu", false],
    ["Bus", "Bu", false],
    ["Campus", "Campu", false],
    ["Cosmos", "Cosmo", false],
    ["Ethos", "Etho", false],
    ["Virus", "Viru", false],
    ["Alias", "Alia", false],
    ["Canvas", "Canva", false],
    ["Gas", "Ga", false],
    ["Lens", "Len", false],
    ["News", "New", false],
    ["Series", "Serie", false],
    ["Species", "Specie", false],
    ["Access", "Acces", false],
    ["Address", "Addres", false],
    ["Class", "Clas", false],
    ["Process", "Proces", false],
    ["Status", "Statu", false],
    ["FieldMouse", "FieldMice", false],
  ])(
    "compares authored spellings %s and %s without normalizing either",
    (left, right, equivalent) => {
      expect(normalizeTypeName(left)).toBe(left);
      expect(normalizeTypeName(right)).toBe(right);
      expect(typeNamesEquivalent(left, right)).toBe(equivalent);
      expect(typeNamesEquivalent(right, left)).toBe(equivalent);
    },
  );

  test("allows exact-match-only equivalence to reject a default morphology relation", () => {
    const parsed = parseSimpleStateForm("a set of Mice with\n  a parent Mouse", {
      typeNameEquivalence: (left, right) => left === right,
    });

    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Mice", declaredNames: ["Mice"] },
    ]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      { value: { reference: { text: "Mouse", referenceKind: "unresolved" } } },
    ]);
  });

  test("admits only authored spellings related by an injected alias table", () => {
    const aliases = new Set(["Wug\0Wuggen", "Wuggen\0Wug"]);
    const parsed = parseSimpleStateForm("a set of Wuggen with\n  a parent Wug", {
      typeNameEquivalence: (left, right) => aliases.has(`${left}\0${right}`),
    });

    expect(parsed.document.inventory.types).toMatchObject([
      { name: "Wuggen", declaredNames: ["Wug", "Wuggen"] },
    ]);
    expect(parsed.document.declarations[0]?.fields).toMatchObject([
      {
        value: {
          reference: { text: "Wug", normalized: "Wuggen", referenceKind: "owned" },
        },
      },
    ]);
  });

  test("uses the exported English equivalence when no injection is supplied", () => {
    const source = "a set of Mice with\n  a parent Mouse\n\na set of Parties with\n  a host Party";
    const defaulted = parseSimpleStateForm(source);
    const explicit = parseSimpleStateForm(source, { typeNameEquivalence: typeNamesEquivalent });

    expect(defaulted).toEqual(explicit);
    expect(ownedTypeNameSpellings(defaulted.document.inventory)).toEqual([
      "Mice",
      "Mouse",
      "Parties",
      "Party",
    ]);
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

  test("diagnoses orphan fields before a declaration and after a malformed declaration", () => {
    const source = `  a owner
  owner String
  a user may own many Items

a set of Records with garbage
  an optional owner`;
    const parsed = parseSimpleStateForm(source);
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "SSF_MALFORMED_FIELD",
      "SSF_MALFORMED_FIELD",
      "SSF_MALFORMED_DECLARATION",
      "SSF_MALFORMED_FIELD",
    ]);
    expect(parsed.document.opaqueLines.map(({ text }) => text)).toEqual([
      "  a owner",
      "  owner String",
      "  a user may own many Items",
      "a set of Records with garbage",
      "  an optional owner",
    ]);
  });

  test("diagnoses malformed article-less fields that use structural keywords", () => {
    expect(
      validateSimpleStateForm(`a set of Groups with
  optional owner
  optional optional owner Person`),
    ).toMatchObject([{ code: "SSF_MALFORMED_FIELD" }, { code: "SSF_MALFORMED_FIELD" }]);
  });

  test("rejects a declaration whose `with` has no body", () => {
    expect(validateSimpleStateForm("a set of Items with")).toMatchObject([
      {
        code: "SSF_MALFORMED_DECLARATION",
        suggestion: "Remove `with` or add at least one indented field.",
      },
    ]);
  });

  test("validates optional fields that omit their article", () => {
    expect(
      validateSimpleStateForm(`a set of Groups with
  owner optional Person
  optional members set of Person`),
    ).toMatchObject([
      { code: "SSF_MISPLACED_OPTIONAL", suggestion: "optional owner Person" },
      { code: "SSF_OPTIONAL_COLLECTION", suggestion: "Remove `optional` from this field." },
    ]);
    expect(validateSimpleStateForm("a set of Groups with\n  optional owner Person")).toEqual([]);
  });

  test("requires an article without dropping a subset name from repairs", () => {
    expect(
      validateSimpleStateForm(`Completed set of Items
  a note String`),
    ).toMatchObject([
      {
        code: "SSF_ARTICLE",
        suggestion: "Use `a Completed set of Items with` or `an Completed set of Items with`.",
      },
      {
        code: "SSF_MISSING_WITH",
        suggestion: "Use `a Completed set of Items with` or `an Completed set of Items with`.",
      },
    ]);
    expect(validateSimpleStateForm("Open set of Items")).toMatchObject([
      {
        code: "SSF_ARTICLE",
        suggestion: "Use `a Open set of Items` or `an Open set of Items`.",
      },
    ]);
    expect(validateSimpleStateForm("a Hour set of Items\nan Hour set of Items")).toEqual([]);
  });

  test("uses the parser's recovered structure for every existing repair", () => {
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
      { code: "SSF_OPTIONAL_COLLECTION", suggestion: "Remove `optional` from this field." },
      { code: "SSF_ARTICLE", suggestion: "an element Settings with" },
    ]);
    expect(
      parseSimpleStateForm(source).document.inventory.identities.map(({ name }) => name),
    ).toEqual(["Groups", "Sessions", "Settings"]);
  });
});

describe("repository SSF corpus", () => {
  test("extracts owned identities from every catalog and application concept specification", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const expected: Readonly<Record<string, readonly string[]>> = {
      "packages/catalog/entries/concept/alerting/spec.md": ["Alerts"],
      "packages/catalog/entries/concept/approving/spec.md": ["Reviews"],
      "packages/catalog/entries/concept/auditing/spec.md": ["Entries"],
      "packages/catalog/entries/concept/authenticating/spec.md": ["Accounts"],
      "packages/catalog/entries/concept/commenting/spec.md": ["Comments"],
      "packages/catalog/entries/concept/discussing/spec.md": ["Discussions", "Responses"],
      "packages/catalog/entries/concept/gathering/spec.md": ["Gatherings", "Memberships"],
      "packages/catalog/entries/concept/inviting/spec.md": ["Invitations"],
      "packages/catalog/entries/concept/labeling/spec.md": ["Applications", "Labels"],
      "packages/catalog/entries/concept/posting/spec.md": ["Posts"],
      "packages/catalog/entries/concept/reserving/spec.md": ["Reservations"],
      "packages/catalog/entries/concept/selecting/spec.md": ["Current", "Selections"],
      "packages/catalog/entries/concept/sessioning/spec.md": ["Sessions"],
      "packages/catalog/entries/concept/timing/spec.md": [],
      "packages/catalog/entries/concept/trashing/spec.md": ["Dispositions"],
      "packages/catalog/entries/concept/upvoting/spec.md": ["Votes"],
      "examples/message-board/design/concepts/Authenticating.md": ["Accounts"],
      "examples/message-board/design/concepts/Commenting.md": ["Comments"],
      "examples/message-board/design/concepts/Posting.md": ["Posts"],
      "examples/message-board/design/concepts/Sessioning.md": ["Sessions"],
      "examples/operations-room/design/concepts/Alerting.md": ["Alerts"],
      "examples/operations-room/design/concepts/Discussing.md": [
        "Discussions",
        "Open",
        "Responses",
      ],
      "examples/operations-room/design/concepts/Gathering.md": ["Gatherings", "Memberships"],
      "examples/operations-room/design/concepts/Selecting.md": ["Current", "Selections"],
      "examples/reading-circle/design/concepts/Discussing.md": ["Discussions", "Open", "Responses"],
      "examples/reading-circle/design/concepts/Gathering.md": ["Gatherings", "Memberships"],
      "examples/reading-circle/design/concepts/Selecting.md": ["Current", "Selections"],
      "tests/packaging/application/src/concepts/mitigating/spec.md": ["Current", "Selections"],
      "tests/packaging/application/src/concepts/rooming/spec.md": ["Rooms"],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Effects.md": [
        "Observations",
      ],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Entries.md": ["Entries"],
      "packages/http/tests/packaging/multi-instance/client/design/concepts/Faulting.md": [],
    };

    for (const [path, names] of Object.entries(expected)) {
      const markdown = await readFile(resolve(root, path), "utf8");
      const parsed = parseSimpleStateForm(stateFence(markdown), {
        externalTypes: externalTypes(markdown),
        evidenceTypeNames: memberTypeEvidence(markdown),
      });
      expect(parsed.diagnostics, path).toEqual([]);
      expect(
        ownedTypeNameSpellings(parsed.document.inventory).some((name) =>
          ["Atlase", "Biase", "Buse", "Canva", "Chaose", "Ga", "Len"].includes(name),
        ),
        path,
      ).toBe(false);
      for (const name of ownedTypeNameSpellings(parsed.document.inventory)) {
        expect(markdown, `${path} must contain accepted spelling ${name}`).toMatch(
          new RegExp(`\\b${name}\\b`),
        );
      }
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
