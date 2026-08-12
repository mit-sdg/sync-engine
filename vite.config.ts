import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import { applicationExamples } from "./examples/register.ts";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@catalog/concepts",
        replacement: resolve(
          import.meta.dirname,
          "packages/catalog/entries/_typecheck/concept-set.ts",
        ),
      },
      {
        find: "@catalog/registrations",
        replacement: resolve(
          import.meta.dirname,
          "packages/catalog/entries/_typecheck/registrations.ts",
        ),
      },
      {
        find: /^@mit-sdg\/sync-engine\/([^/]+)$/,
        replacement: resolve(import.meta.dirname, "src/$1/index.ts"),
      },
      {
        find: /^@mit-sdg\/sync-engine-http\/([^/]+)$/,
        replacement: resolve(import.meta.dirname, "packages/http/src/$1/index.ts"),
      },
      {
        find: /^@mit-sdg\/sync-engine-analysis\/([^/]+)$/,
        replacement: resolve(import.meta.dirname, "packages/analysis/src/$1/index.ts"),
      },
    ],
    tsconfigPaths: true,
  },
  plugins: [
    {
      name: "markdown-as-text",
      enforce: "pre",
      load(id: string) {
        if (!id.endsWith(".md")) return null;
        return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
      },
    },
  ],
  fmt: {
    ignorePatterns: [
      "src/command/setup/**",
      ...Object.values(applicationExamples).flatMap((example) =>
        example.generated.map((path) => `examples/${example.directory}/${path}`),
      ),
    ],
  },
  lint: {
    ignorePatterns: [
      "src/command/setup/**",
      "tests/packaging/application/**",
      "packages/http/tests/packaging/multi-instance/**",
      ...Object.values(applicationExamples).flatMap((example) =>
        example.generated.map((path) => `examples/${example.directory}/${path}`),
      ),
    ],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",

      // Engine design patterns — `then` is a reaction-declaration key, not a Promise
      "unicorn/no-thenable": "off",

      // Intentional: error messages format internal objects via String()
      "typescript/no-base-to-string": "off",

      // Intentional: Frames uses interface+class merging for Array overloads
      "typescript/no-unsafe-declaration-merging": "off",

      // Intentional: overload signatures use `unknown | Fn` for ergonomic APIs
      "typescript/no-redundant-type-constituents": "off",

      // Intentional: template literals used for engine debug logging
      "typescript/restrict-template-expressions": "off",

      // Test code defensively awaits reaction concept actions
      "typescript/await-thenable": "off",

      // Concept action references are deliberately detached methods
      "typescript/unbound-method": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: [
      "examples/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "packages/catalog/entries/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["tests/packaging/application/**", "packages/http/tests/packaging/multi-instance/**"],
    coverage: {
      exclude: ["packages/catalog/entries/**"],
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 94,
        lines: 92,
      },
    },
  },
  staged: {
    "*.{ts,json,md}": "vp check --fix",
  },
});
