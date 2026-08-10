import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function readProject(
  root: string,
): Promise<{ manifest: Record<string, unknown>; guidance: string[] }> {
  const packagePath = `${root}/package.json`;
  if (!existsSync(packagePath))
    throw new Error(
      "catalog add requires a project-root package.json; create one with `bun init -y`",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`package.json is invalid (${String(error)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("package.json must contain an object");
  const manifest = parsed as Record<string, unknown>;
  const guidance: string[] = [];
  const conventional = [
    "src/concept-set.ts",
    "src/composition.ts",
    "src/assembly.ts",
    "generated.config.ts",
  ];
  if (conventional.every((path) => !existsSync(`${root}/${path}`)))
    guidance.push(
      "Run `sync-engine setup` to create the conventional concept-free application files.",
    );
  if (!existsSync(`${root}/tsconfig.json`)) {
    guidance.push(
      "Integration required: tsconfig.json must include copied source and src/catalog/text.generated.d.ts.",
    );
  } else {
    try {
      const config = JSON.parse(await readFile(`${root}/tsconfig.json`, "utf8")) as {
        include?: unknown;
      };
      if (
        Array.isArray(config.include) &&
        !config.include.some(
          (item) =>
            typeof item === "string" &&
            (item === "src" || item.startsWith("src/") || item.includes("**")),
        )
      ) {
        guidance.push(
          "Integration required: tsconfig.json include does not appear to cover copied source and src/catalog/text.generated.d.ts.",
        );
      }
    } catch {
      guidance.push("Integration not verified: tsconfig.json could not be analyzed as JSON.");
    }
  }
  if (!existsSync(`${root}/generated.config.ts`)) {
    guidance.push(
      "Integration required: generated.config.ts must point at the application assembly.",
    );
  }
  const viteConfigs = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mts",
    "vite.config.mjs",
    "vite.config.cts",
    "vite.config.cjs",
  ];
  if (!viteConfigs.some((path) => existsSync(`${root}/${path}`)))
    guidance.push(`Integration required: Vite must load catalog Markdown imports as text. Create vite.config.ts with:
  import { readFileSync } from "node:fs";
  import { defineConfig } from "vite-plus";
  export default defineConfig({ plugins: [{ name: "catalog-markdown-as-text", enforce: "pre", load(id: string) { return id.endsWith(".md") ? \`export default \${JSON.stringify(readFileSync(id, "utf8"))};\` : null; } }] });`);
  const scripts =
    typeof manifest.scripts === "object" && manifest.scripts !== null
      ? (manifest.scripts as Record<string, unknown>)
      : {};
  if (typeof scripts.test !== "string") guidance.push("package.json needs a test script.");
  if (typeof scripts.check !== "string" && typeof scripts.typecheck !== "string")
    guidance.push("package.json needs a check or typecheck script.");
  return { manifest, guidance };
}
export async function integrationGuidance(root: string, floor: string): Promise<string[]> {
  const checks: [string, string, string, string][] = [
    [
      "src/concept-set.ts",
      "./catalog/registrations.generated.ts",
      "catalogRegistrations",
      'import { catalogRegistrations } from "./catalog/registrations.generated.ts";\n  Include: conceptSet({ ...catalogRegistrations, ...yourRegistrations })',
    ],
    [
      "src/composition.ts",
      "./catalog/composition.generated.ts",
      "catalogComposition",
      'import { catalogComposition } from "./catalog/composition.generated.ts";\n  Include: { ...catalogComposition, ...yourComposition }',
    ],
  ];
  const result: string[] = [];
  for (const [path, specifier, identifier, snippet] of checks) {
    const source = existsSync(`${root}/${path}`) ? await readFile(`${root}/${path}`, "utf8") : "";
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const imported = new RegExp(
      `import\\s*\\{[^}]*\\b${identifier}\\b[^}]*\\}\\s*from\\s*["']${escaped}["']`,
      "s",
    ).test(source);
    const included = new RegExp(`\\.\\.\\.${identifier}\\b`).test(source);
    if (!imported || !included) result.push(`Integration required: ${path}\n  ${snippet}`);
  }
  result.push(`Selected catalog floor: ${floor}`);
  const assembly = existsSync(`${root}/src/assembly.ts`)
    ? await readFile(`${root}/src/assembly.ts`, "utf8")
    : "";
  if (
    !new RegExp(
      `\\.implementations\\(\\s*["']${floor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*,`,
    ).test(assembly)
  ) {
    result.push(
      floor === "mongo"
        ? 'Construct it with applicationConcepts.implementations("mongo", { db }). The host owns MongoClient lifetime.'
        : 'Construct it with applicationConcepts.implementations("memory", {}).',
    );
  }
  return result;
}
