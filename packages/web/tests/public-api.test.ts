import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";

test("Web has one exact realization surface", () => {
  const root = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(manifest.exports)).toEqual(["./realization", "./immediates"]);

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
  expect(names).toEqual([
    "realize",
    "ImmediateBindings",
    "RenderedFault",
    "WebHead",
    "WebRealization",
    "applySelection",
    "assembleCandidate",
    "candidatePathPrefix",
    "CandidateManifest",
    "CandidateSelection",
    "SelectionApplication",
    "WebCandidate",
    "interfaceRevision",
  ]);
  const surface = readFileSync(resolve(root, "public-surface.md"), "utf8");
  expect(surface).toContain(
    "<!-- register:web-realization:start -->\n\n`CandidateManifest`, `CandidateSelection`, `ImmediateBindings`, `RenderedFault`, `SelectionApplication`, `WebCandidate`, `WebHead`, `WebRealization`, `applySelection`, `assembleCandidate`, `candidatePathPrefix`, `interfaceRevision`, `realize`\n\n<!-- register:web-realization:end -->",
  );
  expect(surface).toContain(
    "<!-- register:web-immediates:start -->\n\n`ClearOnAccept`, `RefocusOnRefusal`, `stockImmediates`\n\n<!-- register:web-immediates:end -->",
  );
});
