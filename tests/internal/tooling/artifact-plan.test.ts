import { describe, expect, test } from "vite-plus/test";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/language";
import {
  applyArtifactPlan,
  applicationManifest,
  artifactPlan,
  checkArtifactPlan,
  normalizeArtifactPath,
  planGenerated,
} from "@mit-sdg/sync-engine/tooling";
import type { ArtifactFilesystem } from "@mit-sdg/sync-engine/tooling";

class MemoryFilesystem implements ArtifactFilesystem {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly failures = new Set<string>();

  async read(path: string): Promise<string | undefined> {
    if (this.failures.has(path)) throw new Error("unreadable");
    return this.files.get(path);
  }

  async writeAtomic(path: string, content: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, content);
  }
}

describe("artifact plans", () => {
  test.each([
    "../escape.ts",
    "/absolute.ts",
    "nested/../../escape.ts",
    "a\\b.ts",
    "a//b.ts",
    "%2e%2e/escape.ts",
    ".%2e/escape.ts",
    "%2e./escape.ts",
    "nested%2fescape.ts",
    "nested%5cescape.ts",
    "bad-percent-%zz.ts",
    "wire.ts?variant",
    "wire.ts#variant",
    "C:/wire.ts",
    "foo:bar.md",
  ])("rejects unsafe path %s", (path) => {
    expect(() => normalizeArtifactPath(path)).toThrow(
      /relative POSIX|escapes or does not normalize/,
    );
  });

  test("classifies entries and applies only missing or changed content", async () => {
    const plan = artifactPlan([
      { path: "a.txt", content: "same", kind: "manifest" },
      { path: "nested/b.txt", content: "new", kind: "wire" },
      { path: "c.txt", content: "created", kind: "specification" },
    ]);
    const filesystem = new MemoryFilesystem();
    filesystem.files.set("a.txt", "same");
    filesystem.files.set("nested/b.txt", "old");

    expect(await checkArtifactPlan(plan, filesystem)).toEqual([
      { path: "a.txt", kind: "manifest", status: "unchanged" },
      { path: "c.txt", kind: "specification", status: "missing" },
      { path: "nested/b.txt", kind: "wire", status: "changed" },
    ]);
    await applyArtifactPlan(plan, filesystem);
    expect(filesystem.writes).toEqual(["c.txt", "nested/b.txt"]);
    expect(filesystem.files.get("a.txt")).toBe("same");
    expect(filesystem.files.get("nested/b.txt")).toBe("new");
  });

  test("a failed preflight prevents every write", async () => {
    const plan = artifactPlan([
      { path: "a.txt", content: "a", kind: "manifest" },
      { path: "b.txt", content: "b", kind: "wire" },
    ]);
    const filesystem = new MemoryFilesystem();
    filesystem.failures.add("b.txt");

    expect(await applyArtifactPlan(plan, filesystem)).toContainEqual({
      path: "b.txt",
      kind: "wire",
      status: "failed",
      errorClass: "Error",
    });
    expect(filesystem.writes).toEqual([]);
  });

  test("plans generated specification and wire from a manifest", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Ping },
    });
    const plan = planGenerated(applicationManifest(app), {
      title: "Ping service",
      specification: "ping.md",
      wire: "wire.ts",
    });

    expect(plan.entries.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "ping.md", kind: "specification" },
      { path: "wire.ts", kind: "wire" },
    ]);
    expect(plan.entries.every(({ digest }) => /^fnv1a64-[0-9a-f]{16}$/.test(digest))).toBe(true);
    expect(plan.entries.find(({ kind }) => kind === "specification")?.content).toContain(
      "# Ping service",
    );
    expect(plan.entries.every(({ content }) => content.includes("1.0.0-beta.0"))).toBe(true);
  });

  test("rejects a manifest produced by another generator version", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );
    manifest.generator.version = "9.9.9";

    expect(() => planGenerated(manifest, { title: "Ping service" })).toThrow(
      /requires generator @mit-sdg\/sync-engine@1\.0\.0-beta\.0/,
    );
  });
});
