import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@design": fileURLToPath(new URL("./design", import.meta.url)),
      "@examples/reading-circle": fileURLToPath(new URL("./src", import.meta.url)),
    },
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
    ignorePatterns: ["generated/**", "node_modules/**"],
  },
  lint: {
    ignorePatterns: ["generated/**", "node_modules/**"],
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
