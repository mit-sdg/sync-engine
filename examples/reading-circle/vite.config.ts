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
  },
  test: {
    include: ["src/concepts/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
