/**
 * Build-time action/query conformance. Registration compares parsed declarations
 * with class methods at startup, but TypeScript erases a parameter's type on the
 * way: `end(_: { session: string })` arrives as `end(_)`. These cases are the
 * ones only the source can settle.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { conceptDirectories, conceptFailures } from "@command/check";

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

describe("the repository's own concepts", () => {
  test("every shipped concept agrees with its specification", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const directories = await conceptDirectories(["examples", "tests/package/application"], root);
    expect(directories.length).toBeGreaterThan(0);
    expect(directories.flatMap((where) => conceptFailures(where, root))).toEqual([]);
  }, 15_000);
});
