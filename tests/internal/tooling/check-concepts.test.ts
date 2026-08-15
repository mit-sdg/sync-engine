import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConceptFiles, checkConceptsCommand } from "@command/check-concepts";
import { describe, expect, test, vi } from "vite-plus/test";

const valid = `# Noting

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
a set of Notes with an author Person and text String
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

describe("draft concept syntax check", () => {
  test("parses only the explicit Markdown files and writes nothing", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-concept-check-"));
    const first = join(root, "Noting.md");
    const second = join(root, "Other.md");
    try {
      await writeFile(first, valid);
      await writeFile(second, valid.replace("# Noting", "# Other"));
      const before = [await readFile(first, "utf8"), await readFile(second, "utf8")];
      await expect(checkConceptFiles(["Noting.md", "Other.md"], root)).resolves.toEqual([
        { path: "Noting.md", definition: "Noting" },
        { path: "Other.md", definition: "Other" },
      ]);
      expect([await readFile(first, "utf8"), await readFile(second, "utf8")]).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("attributes parser diagnostics to the supplied file", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-concept-check-"));
    try {
      await writeFile(join(root, "Broken.md"), valid.replace("## Queries", "## Reads"));
      await expect(checkConceptFiles(["Broken.md"], root)).rejects.toThrow(
        /Concept specification Broken\.md is invalid:.*unknown "## Reads"/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires explicit paths and reports a compact success", async () => {
    await expect(checkConceptsCommand([])).rejects.toThrow("check-concepts <paths...>");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await checkConceptsCommand([
        new URL("../../../examples/reading-circle/design/concepts/Gathering.md", import.meta.url)
          .pathname,
      ]);
      expect(output).toHaveBeenCalledWith("Concept specification syntax check passed for 1 file.");
    } finally {
      output.mockRestore();
    }
  });
});
