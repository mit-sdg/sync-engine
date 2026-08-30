import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDesignCommand, checkDesignFiles } from "@command/check-design";
import { parseSpec } from "@engine/reactions/concepts/concept-spec";
import { specificationOwnedTypeNames } from "@engine/tooling/application-manifest-format";
import { describe, expect, test, vi } from "vite-plus/test";

const concept = `# Noting

## Purpose

Keep a note for later retrieval.

## Principle

A person writes a note and reads it back by its identity.

## Types

\`\`\`types
external Person
  The note author.
\`\`\`

## State

\`\`\`state
a set of Notes with
  an author Person
  a text String
\`\`\`

## Actions

\`\`\`actions
write (author: Person, text: String) : return (note: Note)
  where true
  then
    add a Note
    return note
\`\`\`

## Queries

\`\`\`queries
_note (note: Note) : optional (author: Person, text: String)
\`\`\`
`;

const composition = `# Notes composition

[Publishing](reaction:Notes.Publish) uses [the feed](view:Notes.Feed),
[its former](former:Notes.FormFeed), and [formatting](computation:formatTitle).

\`\`\`endpoints
Notes.Publish at /notes/publish
\`\`\`

\`\`\`computations
formatTitle(title: String) : String
  Normalizes a displayed title.
\`\`\`
`;

const types = `# Notes application types

\`\`\`types
concrete Person
  A stable application identity.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments
instantiate Posting
\`\`\`

\`\`\`bindings
Comments.User is Person
Comments.Target is Posting.Post
\`\`\`
`;

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sync-engine-design-check-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("authored design form check", () => {
  test("accepts a mixed corpus by content and preserves operand order", async () => {
    const root = await fixture({
      "arbitrary/first.data": composition,
      "second.txt": concept,
      "elsewhere/third": types,
    });
    try {
      await expect(
        checkDesignFiles(["arbitrary/first.data", "second.txt", "elsewhere/third"], root),
      ).resolves.toEqual([
        { path: "arbitrary/first.data", kind: "application" },
        { path: "second.txt", kind: "concept" },
        { path: "elsewhere/third", kind: "application" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a partial detached-binding corpus without requiring its instance document", async () => {
    const root = await fixture({
      "bindings.md": "# Detached bindings\n\n```bindings\nComments.User is Person\n```\n",
    });
    try {
      await expect(checkDesignFiles(["bindings.md"], root)).resolves.toEqual([
        { path: "bindings.md", kind: "application" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["wildcard reaction", "[bad](reaction:Notes.*)", /exact non-wildcard/],
    ["empty view", "[bad](view:)", /exact non-wildcard/],
    ["malformed former", "[bad](former:Notes..Form)", /exact non-wildcard/],
    ["dotted computation", "[bad](computation:format.title)", /exact non-wildcard/],
  ])("rejects a %s target", async (_name, link, expected) => {
    const root = await fixture({ "bad.md": `# Bad target\n\n${link}\n` });
    try {
      await expect(checkDesignFiles(["bad.md"], root)).rejects.toThrow(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    [
      "computation signature",
      "# Bad computation\n\n```computations\nformat(value String) : String\n  Formats it.\n```\n",
      /invalid computation input/,
    ],
    [
      "concrete declaration",
      "# Bad concrete\n\n```types\nconcrete Person\n```\n",
      /needs an indented prose definition/,
    ],
    [
      "endpoint declaration",
      "# Bad endpoint\n\n```endpoints\nNotes.Publish on /notes/publish\n```\n",
      /Declaration\.Identity at \/path/,
    ],
    [
      "endpoint path",
      "# Bad endpoint path\n\n```endpoints\nNotes.Publish at notes/publish\n```\n",
      /absolute route pathname/,
    ],
    [
      "binding left side",
      "# Bad binding\n\n```bindings\nUser is Person\n```\n",
      /accepts only `Instance.External is Target`/,
    ],
    [
      "binding target",
      "# Bad target\n\n```bindings\nComments.User is Other..Person\n```\n",
      /accepts only `Instance.External is Target`/,
    ],
  ])("rejects malformed %s form", async (_name, markdown, expected) => {
    const root = await fixture({ "bad.md": markdown });
    try {
      await expect(checkDesignFiles(["bad.md"], root)).rejects.toThrow(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    [
      "endpoint",
      `# Duplicate endpoint

\`\`\`endpoints
Notes.Publish at /notes/publish
Notes.Publish at /notes/other
\`\`\`
`,
      "DUPLICATE_ENDPOINT",
    ],
    [
      "computation",
      `# Duplicate computation

\`\`\`computations
same() : String
  First definition.
same() : String
  Second definition.
\`\`\`
`,
      "DUPLICATE_COMPUTATION",
    ],
    [
      "concrete type",
      `# Duplicate concrete

\`\`\`types
concrete Person
  First definition.
concrete Person
  Second definition.
\`\`\`
`,
      "DUPLICATE_CONCRETE_TYPE",
    ],
    [
      "binding",
      `# Duplicate binding

\`\`\`instances
instantiate Commenting as Comments
\`\`\`

\`\`\`bindings
Comments.User is Person
Comments.User is Posting.Author
\`\`\`
`,
      "DUPLICATE_EXTERNAL_BINDING",
    ],
  ])("rejects a duplicate %s across the supplied corpus", async (_name, duplicate, code) => {
    const root = await fixture({ "valid.md": composition, "duplicate.md": duplicate });
    try {
      await expect(checkDesignFiles(["valid.md", "duplicate.md"], root)).rejects.toThrow(
        new RegExp(`duplicate\\.md:.*\\[${code}\\]`, "s"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses the strict concept parser for concept-shaped documents", async () => {
    const root = await fixture({ "broken.md": concept.replace("## Queries", "## Reads") });
    try {
      await expect(checkDesignFiles(["broken.md"], root)).rejects.toThrow(
        /Design document broken\.md is invalid: broken\.md:.*\[CONCEPT_SPEC_DOCUMENT_STRUCTURE\].*unknown "## Reads"/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports every invalid file in one run", async () => {
    const root = await fixture({
      "first.md": concept.replace("## Queries", "## Reads"),
      "second.md": concept.replace("Keep a note for later retrieval.", ""),
      "third.md": concept.replace("## Actions", "## Operations"),
    });
    try {
      await expect(checkDesignFiles(["first.md", "second.md", "third.md"], root)).rejects.toThrow(
        /Design document first\.md is invalid:.*Design document second\.md is invalid:.*Design document third\.md is invalid:/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports multiple parser faults from one concept document", async () => {
    const root = await fixture({
      "broken.md": concept
        .replace("Keep a note for later retrieval.", "")
        .replace("A person writes a note and reads it back by its identity.", ""),
    });
    try {
      await expect(checkDesignFiles(["broken.md"], root)).rejects.toThrow(
        /\[CONCEPT_SPEC_PROSE_SECTION\].*"## Purpose" section is empty.*\[CONCEPT_SPEC_PROSE_SECTION\].*"## Principle" section is empty/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports every application-form issue", async () => {
    const document = (title: string) => `# ${title}

\`\`\`computations
same() : String
  Produces a stable value.
\`\`\`

\`\`\`types
concrete Person
  A stable application identity.
\`\`\`

\`\`\`instances
instantiate Commenting as Comments
\`\`\`

\`\`\`bindings
Comments.User is Person
\`\`\`
`;
    const root = await fixture({ "first.md": document("First"), "second.md": document("Second") });
    try {
      await expect(checkDesignFiles(["first.md", "second.md"], root)).rejects.toThrow(
        /\[DUPLICATE_COMPUTATION\].*\[DUPLICATE_CONCRETE_TYPE\].*\[DUPLICATE_INSTANCE\].*\[DUPLICATE_EXTERNAL_BINDING\]/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps the success summary for a valid corpus", async () => {
    const root = await fixture({ "one.md": concept, "two.md": composition, "three.md": types });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.cwd();
    try {
      process.chdir(root);
      await checkDesignCommand(["one.md", "two.md", "three.md"]);
      expect(output).toHaveBeenCalledTimes(1);
      expect(output).toHaveBeenCalledWith("Design form check passed for 3 files.");
    } finally {
      process.chdir(previous);
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fails recognized noncanonical SSF with deterministic repairs", async () => {
    const malformed = concept.replace(
      "a set of Notes with\n  an author Person\n  a text String",
      "a sequence of Notes\n  a discardedAt optional DateTime",
    );
    const root = await fixture({ "broken.md": malformed });
    try {
      await expect(checkDesignFiles(["broken.md"], root)).rejects.toThrow(
        /broken\.md:.*\[SSF_NEAR_MISS_KEYWORD\].*suggestion: a seq of Notes with.*\[SSF_MISSING_WITH\].*suggestion: a seq of Notes with.*\[SSF_MISPLACED_MODIFIER\].*suggestion:   a optional discardedAt DateTime/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects undeclared signature types at their exact authored locations", async () => {
    const markdown = concept.replace("text: String", "text: Blancmange");
    const line = markdown.split("\n").findIndex((text) => text.includes("text: Blancmange")) + 1;
    const column = markdown.split("\n")[line - 1]!.indexOf("Blancmange") + 1;
    const root = await fixture({ "signature.md": markdown });
    try {
      await expect(checkDesignFiles(["signature.md"], root)).rejects.toThrow(
        new RegExp(
          `signature\\.md:${String(line)}:${String(column)}: \\[SSF_UNDECLARED_TYPE\\].*Declare it in the Types fence`,
          "s",
        ),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["person", "SSF_INVALID_EXTERNAL_NAME"],
    ["String", "SSF_NAME_COLLISION"],
  ])("reports external %s diagnostics at the Types declaration", async (name, code) => {
    const markdown = concept.replace("external Person", `external ${name}`);
    const line = markdown.split("\n").findIndex((text) => text === `external ${name}`) + 1;
    const root = await fixture({ "external.md": markdown });
    try {
      await expect(checkDesignFiles(["external.md"], root)).rejects.toThrow(
        new RegExp(`external\\.md:${String(line)}:10: \\[${code}\\]`),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("formats invalid external SSF errors at the Types declaration for the manifest", () => {
    const specification = parseSpec(
      concept.replace("external Person", "external person"),
    ).specification!;
    const externalLocation = specification.externalTypes[0]!.location;
    const stateLocation = specification.state.location;
    let failure: unknown;

    try {
      specificationOwnedTypeNames(specification);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(
      `- line ${String(externalLocation.line)}, column ${String(externalLocation.column)}: [SSF_INVALID_EXTERNAL_NAME] External type "person" is not a valid SSF type name.`,
    );
    expect(message).not.toContain(
      `- line ${String(stateLocation.line)}, column ${String(stateLocation.column)}: [SSF_INVALID_EXTERNAL_NAME]`,
    );
  });

  test("fails an ambiguous automatic alias and keeps the advice that explains it", async () => {
    const ambiguous = concept
      .replace(
        "a set of Notes with\n  an author Person\n  a text String",
        "a set of Axes with\n  a short Ax\n  an anatomical Axis",
      )
      .replaceAll(": Note", ": Axes");
    const root = await fixture({ "advice.md": ambiguous });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Neither candidate joins one-to-one, so neither resolves and the check fails. The
      // advice names the ambiguity, which the undeclared-type error alone would not.
      await expect(checkDesignFiles(["advice.md"], root)).rejects.toThrow(
        /\[SSF_UNDECLARED_TYPE\] Type "Ax"/,
      );
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("[SSF_AMBIGUOUS_AUTOMATIC_ALIAS]"),
      );
    } finally {
      warning.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("resolves an ambiguous candidate once an explicit alias declares it", async () => {
    const resolved = concept
      .replace(
        "a set of Notes with\n  an author Person\n  a text String",
        "a set of Axes with\n  a short Ax\n\nalias Ax for Axes",
      )
      .replaceAll(": Note", ": Axes");
    expect(specificationOwnedTypeNames(parseSpec(resolved).specification!)).toEqual(["Ax", "Axes"]);
    const root = await fixture({ "resolved.md": resolved });
    try {
      await expect(checkDesignFiles(["resolved.md"], root)).resolves.toEqual([
        { path: "resolved.md", kind: "concept" },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("attributes missing, non-regular, and unreadable operands", async () => {
    const root = await fixture({ "valid.md": composition, "unreadable.md": types });
    await mkdir(join(root, "directory.md"));
    await chmod(join(root, "unreadable.md"), 0);
    try {
      await expect(checkDesignFiles(["missing.md"], root)).rejects.toThrow(
        /Design document missing\.md is invalid:.*ENOENT/s,
      );
      await expect(checkDesignFiles(["directory.md"], root)).rejects.toThrow(
        "Design document directory.md is invalid: path is not a regular file",
      );
      if (process.platform !== "win32") {
        await expect(checkDesignFiles(["unreadable.md"], root)).rejects.toThrow(
          /Design document unreadable\.md is invalid:.*EACCES/s,
        );
      }
    } finally {
      await chmod(join(root, "unreadable.md"), 0o600);
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires operands and prints a compact deterministic summary", async () => {
    await expect(checkDesignCommand([])).rejects.toThrow("check-design <paths...>");
    const root = await fixture({ "composition.md": composition });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.cwd();
    try {
      process.chdir(root);
      await checkDesignCommand(["composition.md"]);
      expect(output).toHaveBeenCalledWith("Design form check passed for 1 file.");
    } finally {
      process.chdir(previous);
      output.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("runs from an unrelated directory with no config, assembly, TypeScript project, or Git state", async () => {
    const root = await fixture({
      one: concept,
      two: composition,
      three: types,
    });
    const main = fileURLToPath(new URL("../../../src/command/main.ts", import.meta.url));
    try {
      const before = await readdir(root);
      const checked = spawnSync("bun", [main, "check-design", "one", "two", "three"], {
        cwd: root,
        encoding: "utf8",
      });
      expect({ status: checked.status, stdout: checked.stdout, stderr: checked.stderr }).toEqual({
        status: 0,
        stdout: "Design form check passed for 3 files.\n",
        stderr: "",
      });
      expect(await readdir(root)).toEqual(before);

      await writeFile(join(root, "bad"), "# Bad\n\n[bad](reaction:Notes.*)\n");
      const invalid = spawnSync("bun", [main, "check-design", "bad"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toMatch(/Design document bad is invalid: bad:3:/);

      const missing = spawnSync("bun", [main, "check-design", "absent"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(missing.status).toBe(1);
      expect(missing.stdout).toBe("");
      expect(missing.stderr).toMatch(/Design document absent is invalid:.*ENOENT/s);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
