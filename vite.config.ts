import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",

      // Engine design patterns — `then` is a sync-declaration key, not a Promise
      "unicorn/no-thenable": "off",

      // Intentional: error messages format internal objects via String()
      "typescript/no-base-to-string": "off",

      // Intentional: Frames uses interface+class merging for Array overloads
      "typescript/no-unsafe-declaration-merging": "off",

      // Intentional: overload signatures use `unknown | Fn` for ergonomic APIs
      "typescript/no-redundant-type-constituents": "off",

      // Intentional: template literals used for engine debug logging
      "typescript/restrict-template-expressions": "off",

      // Test code defensively awaits sync concept actions
      "typescript/await-thenable": "off",

      // Concept action references are deliberately detached methods
      "typescript/unbound-method": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
  staged: {
    "*.{ts,json,md}": "vp check --fix",
  },
});
