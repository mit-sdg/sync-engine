import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const names = [
  "HtmlNode",
  "Renderer",
  "RendererDeclaration",
  "RendererInputs",
  "RendererInvocation",
  "RenderingNode",
  "html",
  "isRendererInvocation",
  "renderer",
] as const;

describe("rendering package public API", () => {
  test("the language barrel and reference have the exact exports", () => {
    const packageRoot = resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual(["./language"]);

    const sourceText = readFileSync(resolve(packageRoot, "src/language/index.ts"), "utf8");
    const source = ts.createSourceFile("index.ts", sourceText, ts.ScriptTarget.Latest, true);
    expect(source.statements.every(ts.isExportDeclaration)).toBe(true);
    const actual = source.statements.flatMap((statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map(({ name }) => name.text)
        : [],
    );
    expect(actual.sort()).toEqual([...names].sort());

    const reference = readFileSync(resolve(packageRoot, "public-surface.md"), "utf8");
    const register = [
      "<!-- register:rendering-language:start -->",
      "",
      names.map((name) => `\`${name}\``).join(", "),
      "",
      "<!-- register:rendering-language:end -->",
    ].join("\n");
    expect(reference).toContain("@mit-sdg/sync-engine-rendering/language");
    expect(reference).toContain(register);
  });
});
