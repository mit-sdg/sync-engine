import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const register = {
  compiled: [
    "CompiledHtmlRendering",
    "FormedAsk",
    "FormedAskInput",
    "FormedAskOutput",
    "FormedClauseNode",
    "FormedHtml",
    "FormedHtmlContent",
    "FormedHtmlNode",
    "FormedHtmlPatch",
    "FormedHtmlTree",
    "FormedRead",
    "FormedRendererNode",
    "FormedRowNode",
    "FormedShowNode",
    "RenderingReader",
    "compileHtml",
    "diffHtml",
  ],
  language: [
    "HtmlNode",
    "Renderer",
    "RendererAsk",
    "RendererBindings",
    "RendererBuilder",
    "RendererDeclaration",
    "RendererInputs",
    "RendererInvocation",
    "RendererRead",
    "RendererValueRef",
    "RenderingNode",
    "each",
    "html",
    "isRenderer",
    "isRendererInvocation",
    "renderer",
    "where",
  ],
} as const;

describe("rendering package public API", () => {
  test("the barrels and reference have the exact exports", () => {
    const packageRoot = resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports).sort()).toEqual(["./compiled", "./language"]);

    const reference = readFileSync(resolve(packageRoot, "public-surface.md"), "utf8");
    for (const subpath of Object.keys(register) as Array<keyof typeof register>) {
      const sourceText = readFileSync(resolve(packageRoot, "src", subpath, "index.ts"), "utf8");
      const source = ts.createSourceFile("index.ts", sourceText, ts.ScriptTarget.Latest, true);
      expect(source.statements.every(ts.isExportDeclaration)).toBe(true);
      const actual = source.statements.flatMap((statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(({ name }) => name.text)
          : [],
      );
      expect(actual.sort()).toEqual([...register[subpath]].sort());

      const block = [
        `<!-- register:rendering-${subpath}:start -->`,
        "",
        register[subpath].map((name) => `\`${name}\``).join(", "),
        "",
        `<!-- register:rendering-${subpath}:end -->`,
      ].join("\n");
      expect(reference).toContain(`@mit-sdg/sync-engine-rendering/${subpath}`);
      expect(reference).toContain(block);
    }
  });
});
