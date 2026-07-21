import { readFile, stat } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const guideDirectory = new URL("../../docs/guide/", import.meta.url);
const guideFiles = [
  "getting-started.md",
  "concepts.md",
  "reactions.md",
  "application-boundary.md",
  "views-and-formers.md",
];
const excerptDocs = [
  ...guideFiles.map((file) => new URL(file, guideDirectory)),
  new URL("../../docs/book.md", import.meta.url),
];

const sourceBlock =
  /(?:_Source|Source): \[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)_?\n\n(`{3,})([^\n]*)\n([\s\S]*?)\n\2/g;
const typeScriptBlock = /^```ts\n([\s\S]*?)\n```$/gm;
const repositoryOnlySources = new Map<string, URL[]>([
  [
    new URL("getting-started.md", guideDirectory).pathname,
    [
      new URL("../package/application/text.d.ts", import.meta.url),
      new URL("../package/application/src/concepts/rooming/errors.ts", import.meta.url),
      new URL("../package/application/src/concepts/rooming/rooming.ts", import.meta.url),
      new URL("../package/application/src/concepts/rooming/registry.ts", import.meta.url),
      new URL("../package/application/src/concepts/rooming/rooming.test.ts", import.meta.url),
      new URL("../package/application/src/concepts/mitigating/mitigating.ts", import.meta.url),
      new URL("../package/application/src/concepts/mitigating/registry.ts", import.meta.url),
      new URL("../package/application/src/concept-set.ts", import.meta.url),
      new URL("../package/application/src/composition.ts", import.meta.url),
      new URL("../package/application/src/assembly.ts", import.meta.url),
      new URL("../package/application/generated.config.ts", import.meta.url),
      new URL("../package/application/src/edge.ts", import.meta.url),
      new URL("../package/application/src/scenario.ts", import.meta.url),
    ],
  ],
  [
    new URL("../../docs/book.md", import.meta.url).pathname,
    [new URL("../docs/book.test.ts", import.meta.url)],
  ],
  [
    new URL("reactions.md", guideDirectory).pathname,
    [
      new URL("../internal/reactions/chains.test.ts", import.meta.url),
      new URL("../docs/book.test.ts", import.meta.url),
    ],
  ],
  [
    new URL("views-and-formers.md", guideDirectory).pathname,
    [new URL("../internal/reads/formers.test.ts", import.meta.url)],
  ],
]);

function atExcerptIndents(source: string): string[] {
  return Array.from({ length: 9 }, (_, level) =>
    source.replace(new RegExp(`^ {${level * 2}}`, "gm"), ""),
  );
}

function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const duplicates = new Map<string, number>();
  let fence: string | undefined;

  for (const line of markdown.split("\n")) {
    const marker = line.trimStart().match(/^(`{3,}|~{3,})/i)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading === undefined) continue;
    const base = heading
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/`/g, "")
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
      .replace(/ /g, "-");
    const seen = duplicates.get(base) ?? 0;
    duplicates.set(base, seen + 1);
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
  }

  return anchors;
}

describe("guided curriculum", () => {
  test("the clean-project guide contains every standalone authored file", async () => {
    const guide = await readFile(new URL("getting-started.md", guideDirectory), "utf8");
    const application = new URL("../package/application/", import.meta.url);
    const authored = [
      "package.json",
      "tsconfig.project.json",
      "text.d.ts",
      "src/concepts/rooming/spec.md",
      "src/concepts/rooming/errors.ts",
      "src/concepts/rooming/rooming.ts",
      "src/concepts/rooming/registry.ts",
      "src/concepts/rooming/rooming.test.ts",
      "src/concepts/mitigating/spec.md",
      "src/concepts/mitigating/mitigating.ts",
      "src/concepts/mitigating/registry.ts",
      "src/concept-set.ts",
      "src/composition.ts",
      "src/assembly.ts",
      "generated.config.ts",
      "src/edge.ts",
      "src/scenario.ts",
    ];

    for (const path of authored) {
      const source = (await readFile(new URL(path, application), "utf8")).trim();
      expect(guide, path).toContain(source);
    }
  });

  test("every TypeScript example remains byte-exact source", async () => {
    for (const docUrl of excerptDocs) {
      const doc = await readFile(docUrl, "utf8");
      const sources: string[] = [];
      for (const match of doc.matchAll(sourceBlock)) {
        const [, relativeSource] = match;
        sources.push(await readFile(new URL(relativeSource, docUrl), "utf8"));
      }
      for (const sourceUrl of repositoryOnlySources.get(docUrl.pathname) ?? []) {
        sources.push(await readFile(sourceUrl, "utf8"));
      }

      const candidates = sources.flatMap(atExcerptIndents);
      for (const [, excerpt] of doc.matchAll(typeScriptBlock)) {
        expect(
          candidates.some((source) => source.includes(excerpt)),
          `${docUrl.pathname}: ${excerpt.slice(0, 80)}`,
        ).toBe(true);
      }
    }
  });

  test("shipped guides do not link to repository-only tests", async () => {
    const docs = [
      ...excerptDocs,
      new URL("../../examples/README.md", import.meta.url),
      new URL("../../examples/operations-room/README.md", import.meta.url),
      new URL("../../examples/reading-circle/README.md", import.meta.url),
    ];
    for (const docUrl of docs) {
      const markdown = await readFile(docUrl, "utf8");
      expect(markdown, docUrl.pathname).not.toMatch(/\[[^\]]+\]\([^)]*tests\//);
    }
  });

  test("the documentation router points to the public API without copying subpaths", async () => {
    const index = await readFile(new URL("../../docs/README.md", import.meta.url), "utf8");

    expect(index).toContain("[Public API\n  reference](./public-surface.md)");
    expect(index).not.toContain("@mit-sdg/sync-engine/utils");
  });

  test("local links and anchors resolve and guides avoid unsupported entrypoints", async () => {
    const docs = [
      new URL("../../README.md", import.meta.url),
      new URL("../../docs/README.md", import.meta.url),
      new URL("../../docs/book.md", import.meta.url),
      new URL("../../docs/public-surface.md", import.meta.url),
      new URL("../../docs/semantics.md", import.meta.url),
      new URL("../../docs/consistency-and-operations.md", import.meta.url),
      new URL("../../examples/README.md", import.meta.url),
      new URL("../../examples/concepts/README.md", import.meta.url),
      new URL("../../examples/operations-room/README.md", import.meta.url),
      new URL("../../examples/operations-room/generated/README.md", import.meta.url),
      new URL("../../examples/reading-circle/README.md", import.meta.url),
      new URL("../../examples/reading-circle/generated/README.md", import.meta.url),
      ...guideFiles.map((file) => new URL(file, guideDirectory)),
    ];
    for (const docUrl of docs) {
      const markdown = await readFile(docUrl, "utf8");
      expect(markdown).not.toMatch(/from\s+["']@mit-sdg\/sync-engine["']/);
      if (!docUrl.pathname.endsWith("/public-surface.md")) {
        expect(markdown).not.toMatch(/\bReacting\b|\bClock\b|\bRandom\b/);
      }

      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:)/.test(target)) continue;
        const hashAt = target.indexOf("#");
        const path = hashAt < 0 ? target : target.slice(0, hashAt);
        const fragment = hashAt < 0 ? undefined : decodeURIComponent(target.slice(hashAt + 1));
        const targetUrl = path.length === 0 ? docUrl : new URL(path, docUrl);
        await expect(stat(targetUrl), `${docUrl.pathname}: ${target}`).resolves.toBeDefined();
        if (fragment !== undefined) {
          const targetMarkdown = await readFile(targetUrl, "utf8");
          expect(headingAnchors(targetMarkdown), `${docUrl.pathname}: ${target}`).toContain(
            fragment,
          );
        }
      }
    }
  });
});
