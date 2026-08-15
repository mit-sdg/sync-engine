import { describe, expect, test } from "vite-plus/test";
import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { applicationManifest } from "@mit-sdg/sync-engine/tooling";
import {
  applyArtifactPlan,
  artifactPlan,
  checkArtifactPlan,
  planGenerated,
} from "@engine/tooling/artifact-plan";
import type { ArtifactFilesystem } from "@engine/tooling/artifact-plan";
import type { WireContractsIR } from "@engine/boundary/wire/wire-contracts";
import type { WireOrigin } from "@engine/boundary/wire/wire-types";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

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
    expect(() => artifactPlan([{ path, content: "", kind: "wire" }])).toThrow(
      /relative POSIX|escapes or does not normalize/,
    );
  });

  test("classifies entries and applies only missing or changed content", async () => {
    const plan = artifactPlan([
      { path: "a.txt", content: "same", kind: "specification" },
      { path: "nested/b.txt", content: "new", kind: "wire" },
      { path: "c.txt", content: "created", kind: "specification" },
    ]);
    const filesystem = new MemoryFilesystem();
    filesystem.files.set("a.txt", "same");
    filesystem.files.set("nested/b.txt", "old");

    expect(await checkArtifactPlan(plan, filesystem)).toEqual([
      { path: "a.txt", kind: "specification", status: "unchanged" },
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
      { path: "a.txt", content: "a", kind: "specification" },
      { path: "b.txt", content: "b", kind: "wire" },
    ]);
    const filesystem = new MemoryFilesystem();
    filesystem.failures.add("b.txt");

    expect(await applyArtifactPlan(plan, filesystem)).toContainEqual({
      path: "b.txt",
      kind: "wire",
      status: "failed",
    });
    expect(filesystem.writes).toEqual([]);
  });

  test("plans generated specification and wire from a manifest", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Ping },
    });
    const manifest = applicationManifest(app);
    const plan = planGenerated(manifest, {
      title: "Ping service",
      specification: "ping.md",
      specificationBanner: "<!-- Ping specification -->",
      wire: "wire.ts",
      wireBanner: "// Ping wire",
      conceptSet: { from: "../src/concept-set.ts", export: "vocabulary" },
      strictLeaves: true,
      projections: [
        {
          name: "PingProjectedWire",
          wire: manifest.wire,
          provenance: { name: "@example/projector", version: "1.0.0" },
        },
      ],
    });

    expect(plan.entries.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "ping.md", kind: "specification" },
      { path: "wire.ts", kind: "wire" },
    ]);
    expect(plan.entries.find(({ kind }) => kind === "specification")?.content).toContain(
      "# Ping service",
    );
    expect(
      plan.entries
        .find(({ kind }) => kind === "specification")
        ?.content.startsWith(
          `<!-- Ping specification -->\n<!-- Manifest producer: ${PACKAGE_NAME}@${PACKAGE_VERSION}; concept specification: sync-engine.concept-specification@1; renderer: ${PACKAGE_NAME}@${PACKAGE_VERSION}. -->`,
        ),
    ).toBe(true);
    const wire = plan.entries.find(({ kind }) => kind === "wire")?.content ?? "";
    expect(wire.startsWith(`// Ping wire\n// Generator: ${PACKAGE_NAME}@${PACKAGE_VERSION}.`)).toBe(
      true,
    );
    expect(wire).toContain("export type PingProjectedWire = {");
    expect(wire.match(/export type Json =/g)).toHaveLength(1);
    expect(plan.entries.every(({ content }) => content.includes(PACKAGE_VERSION))).toBe(true);
  });

  test("requires manifest version 1", () => {
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: {},
      }),
    );

    expect(() =>
      planGenerated({ ...manifest, version: 4 } as never, { title: "Old manifest" }),
    ).toThrow("requires an application manifest at version 1");
  });

  test("retains raw authored concept state while assembly-only read-back makes no design claim", () => {
    class CatalogingConcept {
      configure(_: { source?: string }) {
        return {};
      }
      _items(_: { catalog: string }): { item: string }[] {
        return [];
      }
      static readonly queries = { _items: "many" } as const;
    }
    const registration = registerConcept({
      class: CatalogingConcept,
      spec: `# Cataloging

## Purpose
Keep a configured catalog.

## Principle
A configured catalog answers item queries.

## Types
\`\`\`types
external Source
  The configuration source.
\`\`\`

## State
\`\`\`state
catalogs: set Catalog
\`\`\`

## Actions
\`\`\`actions
configure(source?: Source) : return ()
  where true
  then
    return
\`\`\`

## Queries
\`\`\`queries
_items(catalog: Catalog) : many (item: String)
\`\`\`
`,
    });
    const set = conceptSet({ Cataloging: registration });
    const manifest = applicationManifest(
      assemble({ conceptSet: set, instances: set.implementations(), composition: {} }),
    );
    const authored = manifest.concepts.find(({ name }) => name === "Cataloging")?.specification;
    expect(authored?.state.body).toBe("catalogs: set Catalog");
    expect(authored?.externalTypes.map(({ name }) => name)).toEqual(["Source"]);
    expect(manifest.design.checked).toBe(false);
    const content = planGenerated(manifest, { title: "Catalog" }).entries.find(
      ({ kind }) => kind === "specification",
    )?.content;
    expect(content).not.toContain("Keep a configured catalog");
    expect(content).not.toContain("catalogs: set Catalog");
  });

  test("strict wire planning requires a concept-set anchor", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );

    expect(() => planGenerated(manifest, { title: "Ping", strictLeaves: true })).toThrow(
      "strictLeaves requires a concept-set type anchor",
    );
  });

  test("rejects projected names that collide in the generated type namespace", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );

    expect(() =>
      planGenerated(manifest, {
        title: "Ping",
        wireName: "PingWire",
        projections: [
          {
            name: "PingHttpWire",
            wire: manifest.wire,
            render: { appWideErrorName: "PingWire" },
            provenance: { name: "@example/projector", version: "1.0.0" },
          },
        ],
      }),
    ).toThrow('duplicate generated type name "PingWire"');
  });

  test("reserves exactly the helpers used by appended contracts", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );
    const projection = (origin: WireOrigin) => ({
      name: "PingProjectedWire",
      wire: {
        appWide: [],
        endpoints: [
          {
            path: "/projected",
            input: { kind: "object" as const, fields: [] },
            output: { kind: "reference" as const, allOf: [origin], sites: ["projection"] },
            errors: [],
            openError: false,
          },
        ],
      } satisfies WireContractsIR,
      render: { appWideErrorName: "AtPath" },
      provenance: { name: "@example/projector", version: "1.0.0" },
    });
    const options = {
      title: "Ping",
      conceptSet: { from: "../src/concept-set.ts", export: "vocabulary" },
    };

    expect(() =>
      planGenerated(manifest, {
        ...options,
        projections: [projection({ source: "literal", value: true })],
      }),
    ).not.toThrow();
    expect(() =>
      planGenerated(manifest, {
        ...options,
        projections: [
          projection({ source: "action-output", concept: "Ping", member: "ping", path: [] }),
        ],
      }),
    ).toThrow('duplicate generated type name "AtPath"');
  });

  test("accepts the manifest format across SemVer 1.x generator versions", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );
    manifest.generator.version = "1.9.9";

    expect(() => planGenerated(manifest, { title: "Ping service" })).not.toThrow();
    manifest.generator.version = "2.0.0";
    expect(() => planGenerated(manifest, { title: "Ping service" })).toThrow(
      `requires a 1.x ${PACKAGE_NAME} generator identity`,
    );
    manifest.generator.version = "1.0.0-beta.3";
    expect(() => planGenerated(manifest, { title: "Ping service" })).not.toThrow();
    for (const version of ["1.9007199254740992.0", "1.9.9+build.1"]) {
      manifest.generator.version = version;
      expect(() => planGenerated(manifest, { title: "Ping service" })).not.toThrow();
    }
  });

  test("accepts projector SemVer across majors and rejects invalid provenance", () => {
    const Ping = endpoint("/ping", () => receive().then(respond({ ok: true })));
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: { Ping },
      }),
    );
    const projection = {
      name: "PingProjectedWire",
      wire: manifest.wire,
      provenance: { name: "@example/projector", version: "2.0.0" },
    };

    expect(() =>
      planGenerated(manifest, { title: "Ping service", projections: [projection] }),
    ).not.toThrow();
    for (const version of ["2.9007199254740992.0", "2.0.0+build.1"]) {
      projection.provenance.version = version;
      expect(() =>
        planGenerated(manifest, { title: "Ping service", projections: [projection] }),
      ).not.toThrow();
    }
    projection.provenance.version = "2.0.0-beta.1";
    expect(() =>
      planGenerated(manifest, { title: "Ping service", projections: [projection] }),
    ).not.toThrow();
    for (const version of ["2.0.0-beta.01", "2.0.0+bad metadata"]) {
      projection.provenance.version = version;
      expect(() =>
        planGenerated(manifest, { title: "Ping service", projections: [projection] }),
      ).toThrow("projection provenance needs a package name and SemVer version");
    }
  });

  test("rejects forged non-portable manifest data", () => {
    const manifest = applicationManifest(
      assemble({
        vocabulary: vocabulary({ concepts: {}, computations: {} }),
        composition: {},
      }),
    );
    manifest.application.unlowered.push({
      name: "ForgedLocal",
      reason: "cannot be registered from data",
      known: { when: [], where: [], then: [], patterns: [] },
    });

    expect(() => planGenerated(manifest, { title: "Forged" })).toThrow(
      /ordinary assembly accepts portable behavior only.*ForgedLocal/s,
    );
  });
});
