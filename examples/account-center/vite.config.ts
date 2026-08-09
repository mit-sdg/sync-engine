import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";

export default defineConfig({
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
    ignorePatterns: ["generated/**", "node_modules/**"],
  },
  lint: {
    ignorePatterns: ["generated/**", "node_modules/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "unicorn/no-thenable": "off",
      "typescript/no-base-to-string": "off",
      "typescript/no-unsafe-declaration-merging": "off",
      "typescript/no-redundant-type-constituents": "off",
      "typescript/restrict-template-expressions": "off",
      "typescript/await-thenable": "off",
      "typescript/unbound-method": "off",
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["src/concepts/**/*.test.ts", "src/composition/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
