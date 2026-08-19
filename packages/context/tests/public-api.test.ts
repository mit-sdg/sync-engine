import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

test("Context has one exact realization surface", () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(manifest.exports)).toEqual(["./realization"]);

  const source = ts.createSourceFile(
    "index.ts",
    readFileSync(resolve(root, "src/realization/index.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  expect(source.statements.every(ts.isExportDeclaration)).toBe(true);
  const names = source.statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.exportClause !== undefined &&
    ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map(({ name }) => name.text)
      : [],
  );
  expect(names).toEqual(["realize", "ContextAskAnswer", "ContextRealization", "ContextUnit"]);
  const surface = readFileSync(resolve(root, "public-surface.md"), "utf8");
  expect(surface).toContain(
    "<!-- register:context-realization:start -->\n\n`ContextAskAnswer`, `ContextRealization`, `ContextUnit`, `realize`\n\n<!-- register:context-realization:end -->",
  );
});
