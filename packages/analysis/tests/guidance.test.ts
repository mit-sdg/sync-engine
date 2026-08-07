import {
  guidanceResourceDigest,
  guidanceSelectionDigest,
  loadGuidanceResource,
  parseGuidanceResource,
  parseGuidanceSelection,
  renderGuidanceResource,
  renderGuidanceSelection,
  selectGuidance,
  validateGuidanceResource,
  validateGuidanceSelection,
  type GuidanceResource,
  type GuidanceSelection,
} from "@mit-sdg/sync-engine-analysis/guidance";
import { describe, expect, test } from "vite-plus/test";

function resourceCopy(resource: GuidanceResource): GuidanceResource {
  return structuredClone(resource);
}

function selectionCopy(selection: GuidanceSelection): GuidanceSelection {
  return structuredClone(selection);
}

describe("canonical guidance public capability", () => {
  test("loads only the adjacent validated resource as recursively frozen cached data", async () => {
    const first = await loadGuidanceResource();
    const second = await loadGuidanceResource();

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.producer.analysis)).toBe(true);
    expect(Object.isFrozen(first.entries[0]?.topics)).toBe(true);
    expect(first.producer).toEqual({
      analysis: { name: "@mit-sdg/sync-engine-analysis", version: "1.0.0-beta.7" },
      coreVersion: "1.0.0-beta.7",
    });
    expect(guidanceResourceDigest(first)).toBe(first.digest);
  });

  test("round-trips canonical resource JSON without changing its identity", async () => {
    const resource = await loadGuidanceResource();
    const rendered = renderGuidanceResource(resource);
    const parsed = parseGuidanceResource(rendered);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(parsed).toEqual(resource);
    expect(guidanceResourceDigest(parsed)).toBe(resource.digest);
    expect(() => validateGuidanceResource(parsed)).not.toThrow();
  });

  test.each([
    [
      "format",
      (value: GuidanceResource): void => {
        (value as { format: string }).format = "other";
      },
    ],
    [
      "analysis producer",
      (value: GuidanceResource): void => {
        (value.producer.analysis as { version: string }).version = "1.0.0-beta.6";
      },
    ],
    [
      "core producer",
      (value: GuidanceResource): void => {
        (value.producer as { coreVersion: string }).coreVersion = "1.0.0-beta.6";
      },
    ],
    [
      "revision",
      (value: GuidanceResource): void => {
        (value.source as { revision: string }).revision = "not-a-revision";
      },
    ],
    [
      "documents digest",
      (value: GuidanceResource): void => {
        (value.source as { documentsDigest: string }).documentsDigest = "0".repeat(64);
      },
    ],
    [
      "document digest",
      (value: GuidanceResource): void => {
        (value.documents[0] as { digest: string }).digest = "0".repeat(64);
      },
    ],
    [
      "document path",
      (value: GuidanceResource): void => {
        (value.documents[0] as { path: string }).path = "other.md";
      },
    ],
    [
      "entry content",
      (value: GuidanceResource): void => {
        (value.entries[0] as { content: string }).content += "tampered";
      },
    ],
    [
      "entry digest",
      (value: GuidanceResource): void => {
        (value.entries[0] as { digest: string }).digest = "0".repeat(64);
      },
    ],
    [
      "resource digest",
      (value: GuidanceResource): void => {
        (value as { digest: string }).digest = "0".repeat(64);
      },
    ],
  ] as const)("rejects %s tampering", async (_name, mutate) => {
    const value = resourceCopy(await loadGuidanceResource());
    mutate(value);
    expect(() => validateGuidanceResource(value)).toThrow();
  });

  test("normalizes filters and selects in stable resource order", async () => {
    const resource = await loadGuidanceResource();
    const selection = selectGuidance(resource, {
      ids: ["semantics-reading", "design-reactions", "semantics-reading"],
      topics: ["reads", "reads"],
      stages: ["review", "implementation", "review"],
      authority: ["reference", "criteria", "reference"],
    });

    expect(selection.filters).toEqual({
      ids: ["design-reactions", "semantics-reading"],
      topics: ["reads"],
      stages: ["implementation", "review"],
      authority: ["criteria", "reference"],
      maxEntries: 50,
      maxBytes: 256 * 1024,
    });
    expect(selection.entries.map(({ id }) => id)).toEqual([
      "design-reactions",
      "semantics-reading",
    ]);
    expect(selection.complete).toBe(true);
    expect(selection.resourceDigest).toBe(resource.digest);
    expect(guidanceSelectionDigest(selection)).toBe(selection.digest);
  });

  test("reports bounded selections as incomplete and rejects absent exact IDs", async () => {
    const resource = await loadGuidanceResource();
    const byCount = selectGuidance(resource, { topics: ["reads"], maxEntries: 1 });
    expect(byCount.entries).toHaveLength(1);
    expect(byCount.complete).toBe(false);

    const entry = resource.entries.find(({ id }) => id === "design-reactions")!;
    const entryBytes = Buffer.byteLength(entry.content, "utf8");
    const byBytes = selectGuidance(resource, {
      ids: [entry.id],
      maxBytes: entryBytes - 1,
    });
    expect(byBytes.entries).toEqual([]);
    expect(byBytes.complete).toBe(false);
    expect(() => selectGuidance(resource, { ids: ["missing-guidance-id"] })).toThrow(
      /Unknown guidance ids/,
    );
    expect(() => selectGuidance(resource, { maxEntries: 1_001 })).toThrow(/hard maximum/);
    expect(() => selectGuidance(resource, { maxBytes: 4 * 1024 * 1024 + 1 })).toThrow(
      /hard maximum/,
    );
  });

  test("observes a pre-aborted selection without returning partial guidance", async () => {
    const resource = await loadGuidanceResource();
    const abort = new AbortController();
    abort.abort("stop");
    expect(() => selectGuidance(resource, { signal: abort.signal })).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });

  test("round-trips selections and rejects selection, producer, entry, and digest tampering", async () => {
    const selection = selectGuidance(await loadGuidanceResource(), {
      ids: ["authoring-define-behavior", "design-reactions"],
    });
    const rendered = renderGuidanceSelection(selection);
    const parsed = parseGuidanceSelection(rendered);
    expect(parsed).toEqual(selection);
    expect(guidanceSelectionDigest(parsed)).toBe(selection.digest);

    const mutations: Array<(value: GuidanceSelection) => void> = [
      (value) => ((value as { resourceDigest: string }).resourceDigest = "0".repeat(64)),
      (value) => ((value.producer.analysis as { version: string }).version = "1.0.0-beta.6"),
      (value) => ((value.producer as { coreVersion: string }).coreVersion = "1.0.0-beta.6"),
      (value) => ((value.entries[0] as { content: string }).content += "tampered"),
      (value) => (value.filters.ids as string[]).reverse(),
      (value) => ((value as { complete: boolean }).complete = !value.complete),
      (value) => ((value as { digest: string }).digest = "0".repeat(64)),
    ];
    for (const mutate of mutations) {
      const value = selectionCopy(selection);
      mutate(value);
      expect(() => validateGuidanceSelection(value)).toThrow();
    }
  });
});
