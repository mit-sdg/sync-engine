import { readFile, stat } from "node:fs/promises";
import { camel, heading, pascal, slug } from "../../src/engine/utils/case.ts";
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
const sourceLabel = /^(?:_Source|Source): \[[^\]]+\]\([^)]+\)_?$/gm;
const typeScriptBlock = /^```ts\n([\s\S]*?)\n```$/gm;
const repositoryOnlySources = new Map<string, URL[]>([
  [
    new URL("getting-started.md", guideDirectory).pathname,
    [
      new URL("../../src/command/scaffold/src/concept-set.ts", import.meta.url),
      new URL("../../src/command/scaffold/src/composition.ts", import.meta.url),
      new URL("../../src/command/scaffold/src/assembly.ts", import.meta.url),
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

describe("guided curriculum", () => {
  test("the getting-started guide describes the scaffold output", async () => {
    const guide = await readFile(new URL("getting-started.md", guideDirectory), "utf8");

    expect(guide).toContain("sync-engine new operations-room");
    expect(guide).toContain("Noting");
    expect(guide).toContain("src/concepts/noting/spec.md");
    expect(guide).toContain("src/concepts/noting/noting.ts");
    expect(guide).toContain("src/concepts/noting/registry.ts");
    expect(guide).toContain("src/concepts/noting/noting.test.ts");
    expect(guide).toContain("src/concept-set.ts");
    expect(guide).toContain("src/composition.ts");
    expect(guide).toContain("src/assembly.ts");
    expect(guide).toContain("edge.ts");
    expect(guide).toContain("scenario.ts");
    expect(guide).toContain("bun run generate");
    expect(guide).toContain("bun run typecheck");
    expect(guide).toContain("bun run principle");
    expect(guide).toContain("bun run start");
  });

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
          sources.push(applyTemplate(text, "operations-room"));
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

    expect(index).toContain("[Public API](docs/public-surface.md)");
    expect(index).not.toContain("@mit-sdg/sync-engine/utils");
  });

  test("local links and anchors resolve and guides avoid unsupported entrypoints", async () => {
    const docs = [
      new URL("../../README.md", import.meta.url),
      new URL("../../docs/book.md", import.meta.url),
      new URL("../../docs/public-surface.md", import.meta.url),
      new URL("../../docs/architecture.md", import.meta.url),
      new URL("../../docs/semantics.md", import.meta.url),
      new URL("../../examples/README.md", import.meta.url),
      new URL("../../examples/operations-room/README.md", import.meta.url),
      new URL("../../examples/reading-circle/README.md", import.meta.url),
      ...guideFiles.map((file) => new URL(file, guideDirectory)),
    ];
    for (const docUrl of docs) {
      const markdown = await readFile(docUrl, "utf8");
      expect(markdown).not.toMatch(/from\s+["']@mit-sdg\/sync-engine["']/);
      if (
        !docUrl.pathname.endsWith("/public-surface.md") &&
        !docUrl.pathname.endsWith("/architecture.md")
      ) {
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
