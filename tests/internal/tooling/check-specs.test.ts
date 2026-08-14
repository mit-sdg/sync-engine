/**
 * Build-time action/query conformance. Registration compares parsed declarations
 * with class methods at startup, but TypeScript erases a parameter's type on the
 * way: `end(_: { session: string })` arrives as `end(_)`. These cases are the
 * ones only the source can settle.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { checkCommand, conceptDirectories, conceptFailures } from "@command/check";
import {
  assembledConcepts,
  loadRegisteredConcepts,
  registeredConcepts,
} from "@command/concept-discovery";
import {
  registeredClassSources,
  registeredConceptSources,
} from "@command/concept-source-discovery";
import { assemble } from "@engine/boundary/assembly/assembly-facade";
import { conceptSet, registerConcept } from "@engine/boundary/assembly/concept-set";
import { vocabulary as declareVocabulary } from "@engine/reactions/authoring/refs";
import { applicationManifest } from "@engine/tooling/manifest";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sync-engine-specs-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const REGISTRY = `import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { SessioningConcept } from "./sessioning.ts";
import spec from "./spec.md" with { type: "text" };

export const sessioning = registerConcept({ class: SessioningConcept, spec });
`;

/** Write one concept directory: its parsed declarations, optional state prose, and class body. */
async function concept(actions: string, body: string, queries = "", state = ""): Promise<string> {
  const where = join(directory, "sessioning");
  await mkdir(where, { recursive: true });
  await writeFile(
    join(where, "spec.md"),
    `# Sessioning\n\n## Purpose\n\nIdentify a caller.\n\n## Principle\n\nA session expires.\n\n` +
      (state === "" ? "" : `## State\n\n${state}\n\n`) +
      `## Actions\n\n\`\`\`actions\n${actions}\n\`\`\`\n` +
      (queries === "" ? "" : `\n## Queries\n\n\`\`\`queries\n${queries}\n\`\`\`\n`),
  );
  await writeFile(join(where, "sessioning.ts"), `export class SessioningConcept {\n${body}\n}\n`);
  await writeFile(join(where, "registry.ts"), REGISTRY);
  return where;
}

describe("inputs the runtime cannot see", () => {
  test("a placeholder parameter still has its declared inputs checked", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end(_: { sessin: string }) {\n    return { ok: true };\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("`end` declares the inputs `session` but the class takes `sessin`"),
    ]);
  });

  test("a plain named parameter still has its declared inputs checked", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end(input: { session: string; extra: string }) {\n    return { ok: Boolean(input) };\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("the class takes `session`, `extra`"),
    ]);
  });

  test("a method taking no parameter contradicts a signature that names inputs", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end() {\n    return { ok: true };\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("declares the inputs `session` but the class takes none"),
    ]);
  });

  test("an empty record parameter describes no inputs", async () => {
    const where = await concept(
      "reset () : return (ok: Flag)\n  then\n    return ok",
      "  reset(_: Record<string, never>) {\n    return { ok: true };\n  }",
    );
    expect(conceptFailures(where)).toEqual([]);
  });

  test("a type alias in the same file resolves", async () => {
    const where = join(directory, "sessioning");
    await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end(_: Input) {\n    return { ok: true };\n  }",
    );
    await writeFile(
      join(where, "sessioning.ts"),
      "type Input = { session: string };\n\n" +
        "export class SessioningConcept {\n  end(_: Input) {\n    return { ok: true };\n  }\n}\n",
    );
    expect(conceptFailures(where)).toEqual([]);
  });

  test("a parameter type the source does not settle fails closed", async () => {
    const where = join(directory, "sessioning");
    await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end(_: Imported) {\n    return { ok: true };\n  }",
    );
    await writeFile(
      join(where, "sessioning.ts"),
      'import type { Imported } from "./elsewhere.ts";\n\n' +
        "export class SessioningConcept {\n  end(_: Imported) {\n    return { ok: true };\n  }\n}\n",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining(
        "the action `end` parameter type `Imported` cannot be checked: any or unresolved type",
      ),
    ]);
    expect(conceptFailures(where)[0]).toContain("Cannot find module './elsewhere.ts'");
  });

  test("resolves imported interfaces, extensions, re-exports, aliases, and qualified names", async () => {
    const where = join(directory, "sessioning");
    await concept(
      [
        "direct (session: Session) : return (ok: Flag)",
        "extended (session: Session, actor: Person) : return (ok: Flag)",
        "aliased (session: Session, actor: Person) : return (ok: Flag)",
        "qualified (session: Session, actor: Person) : return (ok: Flag)",
      ].join("\n"),
      [
        "  direct(_: Input) { return { ok: true }; }",
        "  extended(_: Extended) { return { ok: true }; }",
        "  aliased(_: AliasChain) { return { ok: true }; }",
        "  qualified(_: Contracts.Extended) { return { ok: true }; }",
      ].join("\n"),
    );
    await writeFile(
      join(where, "contracts.ts"),
      [
        "export interface Input { session: string }",
        "export interface Extended extends Input { actor: string }",
        "export type Alias = Extended;",
      ].join("\n"),
    );
    await writeFile(
      join(where, "barrel.ts"),
      'export type { Input, Extended, Alias } from "./contracts.ts";\n',
    );
    await writeFile(
      join(where, "sessioning.ts"),
      [
        'import type { Input, Extended, Alias } from "./barrel.ts";',
        'import type * as Contracts from "./barrel.ts";',
        "type AliasChain = Alias;",
        "export class SessioningConcept {",
        "  direct(_: Input) { return { ok: true }; }",
        "  extended(_: Extended) { return { ok: true }; }",
        "  aliased(_: AliasChain) { return { ok: true }; }",
        "  qualified(_: Contracts.Extended) { return { ok: true }; }",
        "}",
      ].join("\n"),
    );

    expect(conceptFailures(where)).toEqual([]);
  });

  test("resolves intersections, utilities, finite mapped types, and equivalent unions", async () => {
    const where = join(directory, "sessioning");
    await concept(
      [
        "intersected (session: Session, actor: Person) : return (ok: Flag)",
        "utility (session: Session, actor: Person) : return (ok: Flag)",
        "mapped (session: Session, actor: Person) : return (ok: Flag)",
        "union (session: Session) : return (ok: Flag)",
        "record (session: Session, actor: Person) : return (ok: Flag)",
        "neverRecord (session: Session) : return (ok: Flag)",
      ].join("\n"),
      "",
    );
    await writeFile(
      join(where, "sessioning.ts"),
      [
        "type Base = { session: string; actor: string; internal: boolean };",
        "type Intersected = { session: string } & { actor: string };",
        'type Utility = Readonly<Pick<Omit<Base, "internal">, "session" | "actor">>;',
        "type Copy<T> = { readonly [Key in keyof T]: T[Key] };",
        "type Mapped = Copy<Utility>;",
        "type SameKeys = { session: string } | { session: number };",
        'type FiniteRecord = Record<"session" | "actor", string>;',
        'type NeverRecord = Record<"session", never>;',
        "export class SessioningConcept {",
        "  intersected(_: Intersected) { return { ok: true }; }",
        "  utility(_: Utility) { return { ok: true }; }",
        "  mapped(_: Mapped) { return { ok: true }; }",
        "  union(_: SameKeys) { return { ok: true }; }",
        "  record(_: FiniteRecord) { return { ok: true }; }",
        "  neverRecord(_: NeverRecord) { return { ok: true }; }",
        "}",
      ].join("\n"),
    );

    expect(conceptFailures(where)).toEqual([]);
  });

  test("reports ambiguous unions and open index signatures with declarations", async () => {
    const where = join(directory, "sessioning");
    await concept(
      [
        "ambiguous (session: Session) : return (ok: Flag)",
        "distributed (session: Session, actor: Person) : return (ok: Flag)",
        "dynamic (session: Session) : return (ok: Flag)",
      ].join("\n"),
      "",
    );
    await writeFile(
      join(where, "contracts.ts"),
      [
        "export type Ambiguous = { session: string } | { user: string };",
        "export type Distributed = Ambiguous & { actor: string };",
        "export interface Dynamic {",
        "  session: string;",
        "  [key: string]: unknown;",
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(where, "sessioning.ts"),
      [
        'import type { Ambiguous, Distributed, Dynamic } from "./contracts.ts";',
        "export class SessioningConcept {",
        "  ambiguous(_: Ambiguous) { return { ok: true }; }",
        "  distributed(_: Distributed) { return { ok: true }; }",
        "  dynamic(_: Dynamic) { return { ok: true }; }",
        "}",
      ].join("\n"),
    );

    const failures = conceptFailures(where);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toContain("ambiguous union or intersection");
    expect(failures[0]).toContain("[`session`] and [`user`]");
    expect(failures[0]).toContain("contracts.ts:1:");
    expect(failures[1]).toContain("ambiguous union or intersection");
    expect(failures[1]).toContain("[`session`, `actor`] and [`user`, `actor`]");
    expect(failures[1]).toContain("contracts.ts:2:");
    expect(failures[2]).toContain("index signature");
    expect(failures[2]).toContain("contracts.ts:5:");
  });

  test("cyclic aliases terminate with the TypeScript diagnostic", async () => {
    const where = join(directory, "sessioning");
    await concept("end (session: Session) : return (ok: Flag)", "");
    await writeFile(join(where, "contracts.ts"), "export type A = B;\nexport type B = A;\n");
    await writeFile(
      join(where, "sessioning.ts"),
      'import type { A } from "./contracts.ts";\n' +
        "export class SessioningConcept { end(_: A) { return { ok: true }; } }\n",
    );

    const [failure] = conceptFailures(where);
    expect(failure).toContain("cannot be checked");
    expect(failure).toContain("circularly references itself");
  });

  test("uses project path mappings for shared input contracts", async () => {
    const where = join(directory, "sessioning");
    await mkdir(join(directory, "contracts"), { recursive: true });
    await concept("end (session: Session) : return (ok: Flag)", "");
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          baseUrl: ".",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          paths: { "@contracts/*": ["contracts/*"] },
        },
        include: ["**/*.ts"],
      }),
    );
    await writeFile(
      join(directory, "contracts", "input.ts"),
      "export interface Input { session: string }\n",
    );
    await writeFile(
      join(where, "sessioning.ts"),
      'import type { Input } from "@contracts/input";\n' +
        "export class SessioningConcept { end(_: Input) { return { ok: true }; } }\n",
    );

    expect(conceptFailures(where)).toEqual([]);
  });
});

describe("input and result shapes", () => {
  test("treats optional properties and explicit undefined unions equivalently", async () => {
    const where = await concept(
      "update (note?: Text, source?: Text) : return (saved?: Text)\n  then\n    return saved",
      "  update(_: { note?: string; source: string | undefined }): { saved: number | undefined } {\n" +
        "    return { saved: undefined };\n" +
        "  }",
    );

    expect(conceptFailures(where)).toEqual([]);
  });

  test("reports input optionality independently of semantic type names", async () => {
    const where = await concept(
      "update (note?: AuthoredText) : return (saved: AuthoredText)\n  then\n    return saved",
      "  update(_: { note: number }): { saved: boolean } { return { saved: true }; }",
    );

    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("declares the inputs `note?` but the class takes `note`"),
    ]);
  });

  test("checks promised action results and reports names and optionality", async () => {
    const where = await concept(
      [
        "save (text: Text) : return (entry: Entry, warning?: Text)",
        "rename (entry: Entry) : return (entry: Entry, previous?: Text)",
      ].join("\n"),
      [
        "  async save(_: { text: string }): Promise<{ entry: number; warning: string | undefined }> {",
        "    return { entry: 1, warning: undefined };",
        "  }",
        "  rename(_: { entry: string }): { entry: string; prior?: string } {",
        '    return { entry: "one" };',
        "  }",
      ].join("\n"),
    );

    expect(conceptFailures(where)).toEqual([
      expect.stringContaining(
        "`rename` declares the successful result fields `entry`, `previous?` but the class returns `entry`, `prior?`",
      ),
    ]);
  });

  test("checks direct, array, and asynchronous query row shapes", async () => {
    const where = await concept(
      "refresh () : return ()\n  then\n    return",
      [
        "  refresh() { return {}; }",
        "  _one(): { item: number } { return { item: 1 }; }",
        "  _many(): Array<{ item: string; note: string | undefined }> { return []; }",
        "  async _wrong(): Promise<{ other?: boolean }[]> { return []; }",
      ].join("\n"),
      [
        "_one () : one (item: Item)",
        "_many () : many (item: Item, note?: Text)",
        "_wrong () : optional (item?: Item)",
      ].join("\n"),
    );

    expect(conceptFailures(where)).toEqual([
      expect.stringContaining(
        "`_wrong` declares the row fields `item?` but the class returns `other?`",
      ),
    ]);
  });

  test("fails closed on overloaded concept members", async () => {
    const where = await concept(
      "save () : return (entry: Entry)\n  then\n    return entry",
      [
        "  save(): { entry: string };",
        "  save(_: { force?: boolean }): { entry: string };",
        '  save(_: { force?: boolean } = {}) { return { entry: "one" }; }',
      ].join("\n"),
    );

    const failures = conceptFailures(where);
    expect(failures).toHaveLength(2);
    expect(failures.every((failure) => failure.includes("method overload"))).toBe(true);
  });

  test("fails closed when an action result or query row cannot be resolved", async () => {
    const where = await concept(
      "save () : return (entry: Entry)\n  then\n    return entry",
      ["  save(): Imported { return {} as Imported; }", "  _all(): unknown[] { return []; }"].join(
        "\n",
      ),
      "_all () : many (entry: Entry)",
    );
    await writeFile(
      join(where, "sessioning.ts"),
      'import type { Imported } from "./missing.ts";\n' +
        "export class SessioningConcept {\n" +
        "  save(): Imported { return {} as Imported; }\n" +
        "  _all(): unknown[] { return []; }\n" +
        "}\n",
    );

    const failures = conceptFailures(where);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toContain(
      "action `save` successful result type `Imported` cannot be checked",
    );
    expect(failures[0]).toContain("Cannot find module './missing.ts'");
    expect(failures[1]).toContain("query `_all` row type `unknown[]` cannot be checked: unknown");
  });
});

describe("uninterpreted state notation", () => {
  test("arbitrary contradictions do not participate in source checking", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }",
      "",
      "```state\n" +
        "there is no session field and end is a query\n" +
        "the class must use a differently shaped database table {]\n" +
        "```",
    );

    expect(conceptFailures(where)).toEqual([]);
  });
});

describe("reader-facing query behavior", () => {
  test("query prose does not participate in source checking", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }\n" +
        "  _get({ session }: { session: string }) {\n    return [{ session }];\n  }",
      "_get (session: Session) : optional (session: Session)\n" +
        "  answers no row for an unknown Session",
    );

    expect(conceptFailures(where)).toEqual([]);
  });
});

describe("membership, checked without constructing anything", () => {
  test("an action the class lacks fails by name", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  start({ user }: { user: string }) {\n    return { user };\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("declares the action `end`, which the class lacks"),
      expect.stringContaining("class declares the action `start`, which the specification lacks"),
    ]);
  });

  test("a query the specification lacks fails by name", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }\n" +
        "  _get({ session }: { session: string }) {\n    return [{ session }];\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("class declares the query `_get`, which the specification lacks"),
    ]);
  });

  test("a private method is neither an action nor a query", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: this.known(session) };\n  }\n" +
        "  private known(session: string) {\n    return Boolean(session);\n  }",
    );
    expect(conceptFailures(where)).toEqual([]);
  });

  test("a malformed specification fails with the parser's own message", async () => {
    const where = await concept(
      "end (session: Session) : answer (ok: Flag)",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }",
    );
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("an action's signature resolves with `: return"),
    ]);
  });

  test("a registry that registers no class says so", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }",
    );
    await writeFile(join(where, "registry.ts"), "export const sessioning = 1;\n");
    expect(conceptFailures(where)).toEqual([
      expect.stringContaining("registry.ts does not register a class imported by name"),
    ]);
  });
});

describe("concept discovery", () => {
  test("finds concept directories recursively under each supplied root", async () => {
    const first = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) {\n    return { ok: Boolean(session) };\n  }",
    );
    const nested = join(directory, "nested", "expiring");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "spec.md"), "# Expiring\n");

    expect(await conceptDirectories(["."], directory)).toEqual([first, nested].sort());
  });

  test("uses only minimal static work to locate a selected registry's class", async () => {
    const conventional = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) { return { ok: Boolean(session) }; }",
    );
    const design = join(directory, "design", "concepts");
    await mkdir(design, { recursive: true });
    await writeFile(join(design, "Sessioning.md"), await readFile(join(conventional, "spec.md")));
    await writeFile(
      join(conventional, "registry.ts"),
      'import { registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { SessioningConcept } from "./sessioning.ts";\n' +
        'import authored from "../design/concepts/Sessioning.md" with { type: "text" };\n' +
        "export const sessioning = registerConcept({ class: SessioningConcept, spec: authored });\n",
    );
    const source = join(directory, "src", "concept-set.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { sessioning } from "../sessioning/registry.ts";\n' +
        "export const applicationConcepts = conceptSet({ Sessioning: sessioning });\n",
    );

    expect(registeredClassSources(source)).toEqual([
      {
        className: "SessioningConcept",
        classPath: join(conventional, "sessioning.ts"),
        conceptName: "Sessioning",
        specPath: join(design, "Sessioning.md"),
        specText: await readFile(join(design, "Sessioning.md"), "utf8"),
      },
    ]);
  });

  test("runtime registration owns concept and specification discovery", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) { return { ok: Boolean(session) }; }",
    );
    const specification = await readFile(join(where, "spec.md"), "utf8");
    class SessioningConcept {
      end(_: { session: string }) {
        return { ok: true };
      }
    }
    const selected = conceptSet({
      Sessioning: registerConcept({ class: SessioningConcept, spec: specification }),
    });

    const expected = [
      {
        name: "Sessioning",
        className: "SessioningConcept",
        specification: { purpose: "Identify a caller." },
        sourceInputMembers: new Set(["end"]),
      },
    ];
    expect(registeredConcepts(selected.vocabulary)).toMatchObject(expected);

    const assembled = assemble({
      vocabulary: selected.vocabulary,
      instances: selected.implementations(),
      composition: {},
    });
    const manifest = applicationManifest(assembled);
    expect(assembledConcepts(manifest)).toMatchObject(expected);

    const applicationConcept = manifest.concepts.find(({ name }) => name === "Sessioning")!;
    expect(() =>
      assembledConcepts({
        ...manifest,
        concepts: manifest.concepts.map((concept) =>
          concept === applicationConcept ? { ...concept, specification: undefined } : concept,
        ),
      }),
    ).toThrow('Assembled concept "Sessioning" has no specification');
    expect(() =>
      assembledConcepts({
        ...manifest,
        conceptImplementations: manifest.conceptImplementations.map((implementation) =>
          implementation.concept === "Sessioning"
            ? { ...implementation, canonical: { owner: "application" } }
            : implementation,
        ),
      }),
    ).toThrow('Assembled concept "Sessioning" has no canonical class name');
    await assembled.beginDrain();
  });

  test("runtime discovery rejects a missing vocabulary or specification", async () => {
    expect(() => registeredConcepts(null)).toThrow("vocabulary export must be an object");
    class UnspecifiedConcept {
      act() {}
    }
    const unspecified = declareVocabulary({ concepts: { Unspecified: UnspecifiedConcept } });
    expect(() => registeredConcepts(unspecified)).toThrow(
      'Concept-set registration "Unspecified" has no specification',
    );

    const module = join(directory, "missing-vocabulary.mjs");
    await writeFile(module, "export const other = {};\n");
    await expect(loadRegisteredConcepts(module)).rejects.toThrow('does not export "vocabulary"');
  });

  test("follows object-spread registration maps to class imports", async () => {
    const where = await concept(
      "end (session: Session) : return (ok: Flag)\n  then\n    return ok",
      "  end({ session }: { session: string }) { return { ok: Boolean(session) }; }",
    );
    await writeFile(
      join(directory, "registrations.ts"),
      'import { sessioning } from "./sessioning/registry.ts";\n' +
        "export const selected = { Sessioning: sessioning };\n",
    );
    const source = join(directory, "concept-set.ts");
    await writeFile(
      source,
      'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { selected } from "./registrations.ts";\n' +
        "export const applicationConcepts = conceptSet({ ...selected });\n",
    );

    expect(registeredClassSources(source)).toEqual([
      {
        className: "SessioningConcept",
        classPath: join(where, "sessioning.ts"),
        conceptName: "Sessioning",
        specPath: join(where, "spec.md"),
        specText: await readFile(join(where, "spec.md"), "utf8"),
      },
    ]);
  });

  test("traces class and Markdown aliases through mapped imports and registration maps", async () => {
    const design = join(directory, "authored", "design");
    const implementation = join(directory, "shared", "implementation.ts");
    await mkdir(design, { recursive: true });
    await mkdir(dirname(implementation), { recursive: true });
    await writeFile(join(design, "Sessioning.md"), "# Sessioning\n");
    await writeFile(implementation, "export class SessioningConcept {}\n");
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          paths: {
            "@design/*": ["authored/design/*"],
            "@shared/*": ["shared/*"],
          },
        },
        include: ["**/*.ts"],
      }),
    );
    await writeFile(
      join(directory, "registry.ts"),
      'import { registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { SessioningConcept as ImportedClass } from "@shared/implementation.ts";\n' +
        'import importedSpec from "@design/Sessioning.md" with { type: "text" };\n' +
        "const LocalClass = ImportedClass;\n" +
        "const localSpec = importedSpec;\n" +
        "export const registered = registerConcept({ class: LocalClass, spec: localSpec });\n",
    );
    await writeFile(
      join(directory, "registrations.ts"),
      'import { registered as selected } from "./registry.ts";\n' +
        "export const registrations = { SessionInstance: selected };\n",
    );
    const source = join(directory, "concept-set.ts");
    await writeFile(
      source,
      'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { registrations } from "./registrations.ts";\n' +
        "export const selected = conceptSet({ ...registrations });\n",
    );

    expect(registeredConceptSources(source)).toEqual([
      {
        className: "SessioningConcept",
        classPath: implementation,
        conceptName: "SessionInstance",
        specPath: join(design, "Sessioning.md"),
        specText: "# Sessioning\n",
      },
    ]);
  });

  test("fails closed on constructed and unresolvable selected specifications", async () => {
    await writeFile(join(directory, "implementation.ts"), "export class Concept {}\n");
    const source = join(directory, "concept-set.ts");
    const prefix =
      'import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
      'import { Concept } from "./implementation.ts";\n';

    await writeFile(
      source,
      prefix +
        'import spec from "./authored.md" with { type: "text" };\n' +
        'const selected = registerConcept({ class: Concept, spec: spec + "" });\n' +
        "export const set = conceptSet({ Selected: selected });\n",
    );
    await writeFile(join(directory, "authored.md"), "# Authored\n");
    expect(() => registeredClassSources(source)).toThrow("spec is constructed, dynamic");

    await writeFile(
      source,
      prefix +
        'import spec from "./missing.md" with { type: "text" };\n' +
        "const selected = registerConcept({ class: Concept, spec });\n" +
        "export const set = conceptSet({ Selected: selected });\n",
    );
    expect(() => registeredClassSources(source)).toThrow(
      "default specification import `./missing.md` cannot be resolved",
    );
  });

  test("rejects ambiguous selected instance names", async () => {
    await writeFile(join(directory, "spec.md"), "# Shared\n");
    await writeFile(join(directory, "implementation.ts"), "export class Concept {}\n");
    const source = join(directory, "concept-set.ts");
    await writeFile(
      source,
      'import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
        'import { Concept } from "./implementation.ts";\n' +
        'import spec from "./spec.md" with { type: "text" };\n' +
        "const registration = registerConcept({ class: Concept, spec });\n" +
        "export const first = conceptSet({ Same: registration });\n" +
        "export const second = conceptSet({ Same: registration });\n",
    );

    expect(() => registeredClassSources(source)).toThrow(
      "selected concept instance `Same` is ambiguous",
    );
  });

  test("rejects ambiguous or incomplete discovery roots before loading them", async () => {
    await expect(checkCommand(["--vocabulary-module"])).rejects.toThrow(
      "--vocabulary-module path | --config path",
    );
    await expect(
      checkCommand(["--vocabulary-module", "one.ts", "--config", "generated.config.ts"]),
    ).rejects.toThrow("--vocabulary-module path | --config path");
    await expect(
      checkCommand(["--config", "generated.config.ts", "--vocabulary-module", "one.ts"]),
    ).rejects.toThrow("--vocabulary-module path | --config path");
  });

  test("the CLI supports direct registration with nonconventional Markdown", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const project = await mkdtemp(join(root, "tests/.sync-engine-discovery-"));
    try {
      await mkdir(join(project, "src"), { recursive: true });
      await mkdir(join(project, "design", "concepts"), { recursive: true });
      await writeFile(
        join(project, "design", "concepts", "Sessioning.md"),
        "# Sessioning\n\n## Purpose\n\nIdentify a caller.\n\n## Principle\n\nA session expires.\n\n" +
          "## Actions\n\n```actions\nend (session: Session) : return (ok: Flag)\n  then\n    return ok\n```\n",
      );
      await writeFile(join(project, "src", "unregistered-spec.md"), "not a specification");
      await writeFile(
        join(project, "src", "sessioning.ts"),
        "class SessioningBase {\n" +
          "  end(_: { session: string }) { return { ok: true }; }\n" +
          "}\n" +
          "export class SessioningConcept extends SessioningBase {}\n",
      );
      await writeFile(
        join(project, "src", "application-concepts.ts"),
        'import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
          'import { SessioningConcept } from "./sessioning.ts";\n' +
          'import spec from "../design/concepts/Sessioning.md" with { type: "text" };\n' +
          "const Sessioning = registerConcept({ class: SessioningConcept, spec });\n" +
          "export const { vocabulary } = conceptSet({ Sessioning });\n",
      );

      expect(registeredClassSources(join(project, "src", "application-concepts.ts"))).toEqual([
        {
          className: "SessioningConcept",
          classPath: join(project, "src", "sessioning.ts"),
          conceptName: "Sessioning",
          specPath: join(project, "design", "concepts", "Sessioning.md"),
          specText: await readFile(join(project, "design", "concepts", "Sessioning.md"), "utf8"),
        },
      ]);
      const checked = spawnSync(
        "bun",
        [
          join(root, "src/command/main.ts"),
          "check",
          "--vocabulary-module",
          "src/application-concepts.ts",
        ],
        { cwd: project, encoding: "utf8" },
      );
      expect({ status: checked.status, stdout: checked.stdout, stderr: checked.stderr }).toEqual({
        status: 0,
        stdout: "Concept action/query source check passed for 1 concepts.\n",
        stderr: "",
      });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }, 20_000);
});
