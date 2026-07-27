/**
 * The build-time half of the concept contract. Registration compares a
 * specification with its class at startup, but TypeScript erases a parameter's
 * type on the way: `end(_: { session: string })` arrives as `end(_)`. These
 * cases are the ones only the source can settle.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { conceptDirectories, conceptFailures } from "../../../scripts/check-specs.ts";

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

/** Write one concept directory: its specification body and its class body. */
async function concept(actions: string, body: string, queries = ""): Promise<string> {
  const where = join(directory, "sessioning");
  await mkdir(where, { recursive: true });
  await writeFile(
    join(where, "spec.md"),
    `# Sessioning\n\n## Purpose\n\nIdentify a caller.\n\n## Principle\n\nA session expires.\n\n` +
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

  test("a parameter type the source does not settle is left alone", async () => {
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
    const directories = await conceptDirectories(["examples", "tests/package/application"]);
    expect(directories.length).toBeGreaterThan(0);
    expect(directories.flatMap((where) => conceptFailures(where))).toEqual([]);
  });
});
