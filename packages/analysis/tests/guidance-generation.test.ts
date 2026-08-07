import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  GUIDANCE_DOCUMENT_PATHS,
  guidanceResourceFromDocuments,
  inspectGuidanceGitState,
  readGuidanceDocuments,
  resolveGuidanceSourceRevision,
} from "../../../scripts/guidance.ts";
import {
  loadGuidanceResource,
  renderGuidanceResource,
  type GuidanceResource,
} from "@mit-sdg/sync-engine-analysis/guidance";
import { describe, expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function identity(resource: GuidanceResource) {
  return {
    analysisVersion: resource.producer.analysis.version,
    coreVersion: resource.producer.coreVersion,
    revision: resource.source.revision,
  };
}

function sourceText(sources: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = sources.get(path)!;
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function changed(
  sources: ReadonlyMap<string, string | Uint8Array>,
  path: string,
  update: (source: string) => string,
): Map<string, string | Uint8Array> {
  const result = new Map(sources);
  result.set(path, update(sourceText(sources, path)));
  return result;
}

function exactLines(source: string, startLine: number, endLine: number): string {
  const lines = source.match(/[^\n]*(?:\n|$)/g) ?? [];
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(startLine - 1, endLine).join("");
}

describe("guidance resource generation", () => {
  test("is deterministic and extracts exact line ranges and UTF-8 bytes", async () => {
    const loaded = await loadGuidanceResource();
    const sources = await readGuidanceDocuments(root);
    const first = guidanceResourceFromDocuments(sources, identity(loaded));
    const second = guidanceResourceFromDocuments(new Map([...sources].reverse()), identity(loaded));

    expect(renderGuidanceResource(first)).toBe(renderGuidanceResource(second));
    expect(first).toEqual(loaded);
    for (const document of first.documents) {
      expect(document.digest).toBe(sha256(sources.get(document.path)!));
    }
    for (const entry of first.entries) {
      const source = sourceText(sources, entry.path);
      expect(entry.content).toBe(exactLines(source, entry.startLine, entry.endLine));
      expect(entry.digest).toBe(sha256(entry.content));
      expect(source.split("\n")[entry.startLine - 1]).toMatch(/^#{2,3} /);
    }
  });

  test("covers every closed topic and stage with all three authority kinds", async () => {
    const resource = await loadGuidanceResource();
    expect(new Set(resource.entries.flatMap(({ topics }) => topics))).toEqual(
      new Set([
        "application-model",
        "concept-design",
        "concept-boundaries",
        "state-ownership",
        "actions-queries",
        "concept-specification",
        "composition",
        "reactions",
        "reads",
        "boundaries",
        "runtime-semantics",
        "failure-recovery",
        "security",
        "generated-artifacts",
        "verification",
        "operations",
        "release-compatibility",
      ]),
    );
    expect(new Set(resource.entries.flatMap(({ stages }) => stages))).toEqual(
      new Set(["design", "implementation", "verification", "review", "repair", "operation"]),
    );
    expect(new Set(resource.entries.map(({ authority }) => authority))).toEqual(
      new Set(["criteria", "procedure", "reference"]),
    );
  });

  test.each([
    [
      "malformed marker JSON",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace(
            '{"id":"design-concepts-composition"',
            '{"id""design-concepts-composition"',
          ),
        ),
      /marker JSON is invalid/,
    ],
    [
      "duplicate marker id",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace('"id":"design-state-ownership"', '"id":"design-concepts-composition"'),
        ),
      /duplicate guidance id/,
    ],
    [
      "non-adjacent heading",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace(
            "} -->\n\n## Concepts and composition",
            "} -->\n\n\n## Concepts and composition",
          ),
        ),
      /exactly one blank line/,
    ],
    [
      "stale heading anchor",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace('"anchor":"concepts-and-composition"', '"anchor":"wrong-anchor"'),
        ),
      /does not match heading anchor/,
    ],
    [
      "unknown topic tag",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace('"concept-design"]', '"unknown-topic"]'),
        ),
      /unknown value unknown-topic/,
    ],
    [
      "overlapping nested section",
      (sources: ReadonlyMap<string, string | Uint8Array>) =>
        changed(sources, "docs/user/design.md", (source) =>
          source.replace(
            "### State sufficiency",
            '<!-- sync-engine-guidance: {"id":"nested-state-sufficiency","anchor":"state-sufficiency","authority":"criteria","topics":["state-ownership"],"stages":["design"]} -->\n\n### State sufficiency',
          ),
        ),
      /nested guidance marker|overlapping source ranges/,
    ],
  ] as const)("rejects %s", async (_name, mutate, expected) => {
    const loaded = await loadGuidanceResource();
    const sources = await readGuidanceDocuments(root);
    expect(() => guidanceResourceFromDocuments(mutate(sources), identity(loaded))).toThrow(
      expected,
    );
  });

  test("rejects a document set outside the exact path catalog", async () => {
    const loaded = await loadGuidanceResource();
    const sources = await readGuidanceDocuments(root);
    sources.delete(GUIDANCE_DOCUMENT_PATHS[0]);
    expect(() => guidanceResourceFromDocuments(sources, identity(loaded))).toThrow(
      /document catalog must be exactly/,
    );
  });

  test("uses honest dirty, clean, unavailable, and explicit revision identities", async () => {
    const documentsDigest = "a".repeat(64);
    const head = "b".repeat(40);
    expect(
      resolveGuidanceSourceRevision({
        documentsDigest,
        git: { available: true, head, dirty: true },
      }),
    ).toBe(`development:${documentsDigest}`);
    expect(
      resolveGuidanceSourceRevision({
        documentsDigest,
        git: { available: false },
      }),
    ).toBe(`development:${documentsDigest}`);
    expect(
      resolveGuidanceSourceRevision({
        documentsDigest,
        git: { available: true, head, dirty: false },
      }),
    ).toBe(head);
    expect(
      resolveGuidanceSourceRevision({
        documentsDigest,
        explicitRevision: head.toUpperCase(),
        git: { available: true, head, dirty: true },
      }),
    ).toBe(head);
    expect(() =>
      resolveGuidanceSourceRevision({
        documentsDigest,
        explicitRevision: "short",
        git: { available: false },
      }),
    ).toThrow(/exact 40-hex/);
    expect(() =>
      resolveGuidanceSourceRevision({
        documentsDigest,
        explicitRevision: "c".repeat(40),
        git: { available: true, head, dirty: false },
      }),
    ).toThrow(/equal git HEAD/);

    const loaded = await loadGuidanceResource();
    const actualGit = inspectGuidanceGitState(root);
    expect(loaded.source.revision).toBe(
      actualGit.available && actualGit.dirty === false
        ? actualGit.head?.toLowerCase()
        : `development:${loaded.source.documentsDigest}`,
    );
  });
});
