import { readFile, readdir, stat } from "node:fs/promises";
import { camel, heading, pascal, slug } from "@engine/utils/case";
import { describe, expect, test } from "vite-plus/test";

const guideDirectory = new URL("../../docs/user/guide/", import.meta.url);
const guideFiles = [
  "authoring.md",
  "reviewing-a-design.md",
  "read-construction.md",
  "persistence-recovery.md",
];
const firstPartyRawPrefix = "https://raw.githubusercontent.com/mit-sdg/sync-engine/main/";
const persistenceRecovery = new URL("persistence-recovery.md", guideDirectory);
const readConstruction = new URL("read-construction.md", guideDirectory);
const excerptDocs = [
  ...guideFiles.map((file) => new URL(file, guideDirectory)),
  new URL("../../docs/user/design.md", import.meta.url),
];

const sourceBlock =
  /(?:_Source|Source): \[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)_?\n\n(`{3,})([^\n]*)\n([\s\S]*?)\n\2/g;
const sourceLabel = /^(?:_Source|Source): \[[^\]]+\]\([^)]+\)_?$/gm;
const typeScriptBlock = /^```ts\n([\s\S]*?)\n```$/gm;
const repositoryOnlySources = new Map<string, URL[]>([
  [persistenceRecovery.pathname, [new URL("../docs/advanced-recipes.test.ts", import.meta.url)]],
  [readConstruction.pathname, [new URL("../docs/book.test.ts", import.meta.url)]],
]);

function atExcerptIndents(source: string): string[] {
  return Array.from({ length: 9 }, (_, level) =>
    source.replace(new RegExp(`^ {${level * 2}}`, "gm"), ""),
  );
}

function applyTemplate(source: string, name: string): string {
  const h = heading(name);
  const r: Record<string, string> = {
    App: pascal(name),
    app: camel(name),
    heading: h,
    slug: slug(h),
    name,
  };
  return source.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => r[key] ?? _match);
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

async function documentationFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) return documentationFiles(url);
      return entry.name.endsWith(".md") || entry.name === "llms.txt" ? [url] : [];
    }),
  );
  return files.flat();
}

describe("guided curriculum", () => {
  test("every stated excerpt remains byte-exact with its stated source", async () => {
    for (const docUrl of excerptDocs) {
      const doc = await readFile(docUrl, "utf8");
      const excerpts = [...doc.matchAll(sourceBlock)];
      expect(excerpts, `${docUrl.pathname}: source labels`).toHaveLength(
        [...doc.matchAll(sourceLabel)].length,
      );
      for (const match of excerpts) {
        const [, relativeSource, , , excerpt] = match;
        const source = await readFile(new URL(relativeSource, docUrl), "utf8");
        expect(
          atExcerptIndents(source).some((candidate) => candidate.includes(excerpt)),
          `${docUrl.pathname}: ${relativeSource}: ${excerpt.slice(0, 80)}`,
        ).toBe(true);
      }
    }
  });

  test("every unlabelled TypeScript example remains byte-exact executable source", async () => {
    for (const docUrl of excerptDocs) {
      const doc = await readFile(docUrl, "utf8");
      const labelled = new Set(
        [...doc.matchAll(sourceBlock)]
          .filter((match) => match[3].trim() === "ts")
          .map((match) => match[4]),
      );
      const sources: string[] = [];
      for (const sourceUrl of repositoryOnlySources.get(docUrl.pathname) ?? []) {
        const text = await readFile(sourceUrl, "utf8");
        sources.push(text);
        if (text.includes("{{")) {
          sources.push(applyTemplate(text, "note-keeper"));
        }
      }

      const candidates = sources.flatMap(atExcerptIndents);
      for (const [, excerpt] of doc.matchAll(typeScriptBlock)) {
        if (labelled.has(excerpt)) continue;
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

  test("the root documentation map points to the public API without copying subpaths", async () => {
    const index = await readFile(new URL("../../README.md", import.meta.url), "utf8");

    expect(index).toContain("[Public API](docs/user/reference/public-api.md)");
    expect(index).not.toContain("@mit-sdg/sync-engine/utils");
  });

  test("local links and anchors resolve and guides avoid unsupported entrypoints", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { name: string; exports: Record<string, unknown> };
    const entrypoints = new Set(
      Object.keys(manifest.exports).map((path) => `${manifest.name}/${path.replace(/^\.\//, "")}`),
    );
    const docs = [
      new URL("../../README.md", import.meta.url),
      new URL("../../CONTRIBUTING.md", import.meta.url),
      ...(await documentationFiles(new URL("../../docs/", import.meta.url))),
      new URL("../../examples/README.md", import.meta.url),
      new URL("../../examples/operations-room/README.md", import.meta.url),
      new URL("../../examples/reading-circle/README.md", import.meta.url),
    ];
    for (const docUrl of docs) {
      const markdown = await readFile(docUrl, "utf8");
      for (const match of markdown.matchAll(
        /from\s+["'](@mit-sdg\/sync-engine(?:\/[^"']+)*)["']/g,
      )) {
        expect(entrypoints, `${docUrl.pathname}: ${match[1]}`).toContain(match[1]);
      }
      if (
        !docUrl.pathname.endsWith("/public-api.md") &&
        !docUrl.pathname.endsWith("/architecture.md")
      ) {
        expect(markdown).not.toMatch(/\bReacting\b|\bClock\b|\bRandom\b/);
      }

      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const target = match[1];
        const firstPartyRaw = target.startsWith(firstPartyRawPrefix);
        if (/^(?:https?:|mailto:)/.test(target) && !firstPartyRaw) continue;
        const hashAt = target.indexOf("#");
        const targetPath = hashAt < 0 ? target : target.slice(0, hashAt);
        const path = firstPartyRaw ? targetPath.slice(firstPartyRawPrefix.length) : targetPath;
        const fragment = hashAt < 0 ? undefined : decodeURIComponent(target.slice(hashAt + 1));
        const targetUrl =
          path.length === 0
            ? docUrl
            : firstPartyRaw
              ? new URL(`../../${path}`, import.meta.url)
              : new URL(path, docUrl);
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
