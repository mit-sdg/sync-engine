import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

test("Server has one exact serving surface", () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(manifest.exports)).toEqual(["./serve"]);

  const source = ts.createSourceFile(
    "index.ts",
    readFileSync(resolve(root, "src/serve/index.ts"), "utf8"),
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
  expect(names.sort()).toEqual(
    ["RunningServer", "ServeOptions", "ServerAddress", "open", "serve"].sort(),
  );
  expect(readFileSync(resolve(root, "public-surface.md"), "utf8")).toContain(
    "<!-- register:server-serve:start -->\n\n`RunningServer`, `ServeOptions`, `ServerAddress`, `open`, `serve`\n\n<!-- register:server-serve:end -->",
  );
});
