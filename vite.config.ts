import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite-plus";
import { applicationExamples } from "./examples/register.ts";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mit-sdg\/sync-engine\/([^/]+)$/,
        replacement: resolve(import.meta.dirname, "src/$1/index.ts"),
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
      "src/command/scaffold/**",
      ...Object.values(applicationExamples).flatMap((example) =>
        example.generated.map((path) => `examples/${example.directory}/${path}`),
      ),
    ],
  },
  lint: {
    ignorePatterns: [
      "src/command/scaffold/**",
      "tests/package/application/**",
      "tests/package/multi-instance/**",
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
    include: ["examples/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/package/application/**", "tests/package/multi-instance/**"],
    coverage: {
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
