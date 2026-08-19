import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const register = {
  realization: [
    "FetchClaim",
    "FetchRealization",
    "defineFetchRealization",
    "defineLiveFetchRealization",
    "fetchClaimMatches",
    "fetchClaimsOverlap",
    "isFetchRealization",
    "realize",
  ],
  policy: [
    "HttpBrowserPolicy",
    "HttpCookieBinding",
    "HttpLimits",
    "HttpPolicy",
    "HttpPolicyBrand",
    "HttpPolicyInit",
    "HttpPublicErrorCategory",
    "HttpRequestOriginPolicy",
    "httpPolicy",
  ],
  handler: [
    "HttpCorrelationOptions",
    "HttpHandlerOptions",
    "HttpResponseHeadersContext",
    "createHttpHandler",
  ],
  client: [
    "HeadersOption",
    "HttpClientError",
    "HttpClientErrorCode",
    "HttpClientOptions",
    "HttpRequestContext",
    "createHttpClient",
    "createHttpTransport",
  ],
  tooling: ["HttpWireOptions", "httpWire"],
} as const;

function referenceBlock(subpath: keyof typeof register): string {
  const exports = register[subpath].map((name) => `\`${name}\``).join(", ");
  return [
    `<!-- register:http-${subpath}:start -->`,
    "",
    exports,
    "",
    `<!-- register:http-${subpath}:end -->`,
  ].join("\n");
}

describe("HTTP package public API", () => {
  test("the package barrels and reference have their exact exports", () => {
    const packageRoot = resolve(import.meta.dirname, "..");
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports).sort()).toEqual(
      Object.keys(register)
        .map((key) => `./${key}`)
        .sort(),
    );

    const reference = readFileSync(resolve(packageRoot, "public-surface.md"), "utf8");
    for (const subpath of Object.keys(register) as Array<keyof typeof register>) {
      const sourceDirectory = subpath;
      const sourceText = readFileSync(
        resolve(packageRoot, "src", sourceDirectory, "index.ts"),
        "utf8",
      );
      const source = ts.createSourceFile("index.ts", sourceText, ts.ScriptTarget.Latest, true);
      expect(source.statements.every(ts.isExportDeclaration), `${subpath} exports only`).toBe(true);
      const actual = source.statements.flatMap((statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(({ name }) => name.text)
          : [],
      );
      expect(actual.sort(), subpath).toEqual([...register[subpath]].sort());

      const block = referenceBlock(subpath);
      const packagePath = `@mit-sdg/sync-engine-http/${subpath}`;
      expect(reference, `${subpath} full package path`).toContain(packagePath);
      expect(reference, `${subpath} reference unit`).toContain(block);
      expect(reference.indexOf(block), `${subpath} reference unit is unique`).toBe(
        reference.lastIndexOf(block),
      );
    }
  });
});
