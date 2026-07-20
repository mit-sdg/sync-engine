import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import { applicationExamples } from "./examples/register.ts";

export default defineConfig({
  resolve: {
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
    ignorePatterns: Object.values(applicationExamples).flatMap((example) =>
      example.generated.map((path) => `examples/${example.directory}/${path}`),
    ),
  },
  lint: {
    ignorePatterns: ["tests/package/application/**"],
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
    include: ["examples/concepts/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["tests/package/application/**"],
  },
  staged: {
    "*.{ts,json,md}": "vp check --fix",
  },
});
