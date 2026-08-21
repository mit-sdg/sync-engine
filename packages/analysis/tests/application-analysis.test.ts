import {
  applicationManifestDigest,
  type ApplicationDiagnostic,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisError,
  AnalysisLimitError,
  createApplicationAnalysis,
  designRefKey,
  parseDesignRefKey,
  type ApplicationAnalysis,
  type DesignRef,
} from "@mit-sdg/sync-engine-analysis/ir";
import {
  applicationProjectAnalysisDigest,
  loadApplicationProject,
  validateApplicationProjectAnalysis,
  type ApplicationProjectAnalysis,
} from "@mit-sdg/sync-engine-analysis/project";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  applicationProjectFixture,
  fixtureOptions,
  type ApplicationProjectFixture,
} from "./application-project-fixture.ts";

let sharedFixture: ApplicationProjectFixture;
let sharedSnapshot: ApplicationProjectAnalysis;

beforeAll(() => {
  sharedFixture = applicationProjectFixture();
  sharedSnapshot = loadApplicationProject(fixtureOptions(sharedFixture));
});

afterAll(() => sharedFixture.cleanup());

function project(): { fixture: ApplicationProjectFixture; snapshot: ApplicationProjectAnalysis } {
  return {
    fixture: { ...sharedFixture, manifest: structuredClone(sharedFixture.manifest) },
    snapshot: sharedSnapshot,
  };
}

function trustedFacade(
  fixture: ApplicationProjectFixture,
  snapshot: ApplicationProjectAnalysis,
  limits?: Parameters<typeof createApplicationAnalysis>[0]["limits"],
): ApplicationAnalysis {
  return createApplicationAnalysis({
    manifest: fixture.manifest,
    project: snapshot,
    expectedProjectDigest: applicationProjectAnalysisDigest(snapshot),
    ...(limits === undefined ? {} : { limits }),
  });
}

function expectCode(code: string): (error: unknown) => boolean {
  return (caught) => caught instanceof AnalysisError && caught.code === code;
}

const add: DesignRef = { kind: "action", concept: "Notes", action: "add" };

describe("application analysis facade", () => {
  test("serializes stable typed errors without retaining caller data", () => {
    const data = { nested: { value: 1 } };
    const failure = new AnalysisError("INVALID_ARGUMENT", "controlled failure", data);
    data.nested.value = 2;

    expect(failure.toJSON()).toEqual({
      name: "AnalysisError",
      code: "INVALID_ARGUMENT",
      message: "controlled failure",
      data: { nested: { value: 1 } },
    });
    expect(Object.isFrozen(failure.data)).toBe(true);
  });

  test("strictly parses every design reference key", () => {
    const refs: DesignRef[] = [
      { kind: "concept", concept: "Notes" },
      add,
      { kind: "query", concept: "Notes", query: "_all" },
      { kind: "reaction", reaction: "RecordNote" },
      { kind: "view", view: "named view" },
      { kind: "former", former: "named former" },
      { kind: "computation", computation: "ge" },
      { kind: "endpoint", endpoint: "Route", path: "/route" },
    ];
    for (const ref of refs) expect(parseDesignRefKey(designRefKey(ref))).toEqual(ref);
    for (const malformed of [
      "not json",
      JSON.stringify({ kind: "concept", concept: "Notes" }),
      JSON.stringify(["unknown", "x"]),
      JSON.stringify(["concept"]),
      JSON.stringify(["concept", ""]),
    ]) {
      expect(() => parseDesignRefKey(malformed)).toThrow(
        expect.objectContaining({ code: "INVALID_ARGUMENT" }),
      );
    }
  });

  test("creates detached immutable manifest-only and project-backed facades", async () => {
    const { fixture, snapshot } = project();
    const suppliedProject = structuredClone(snapshot);
    const logical = createApplicationAnalysis({ manifest: fixture.manifest });
    const backed = trustedFacade(fixture, suppliedProject);

    fixture.manifest.concepts[0].purpose = "mutated caller value";
    (suppliedProject.provenance as { sourceRevision: string }).sourceRevision = "mutated";
    expect(backed.project?.provenance.sourceRevision).toBe("revision-1");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(backed)).toBe(true);
    expect(Object.isFrozen(backed.project?.sourceIndex.entries[0].sources)).toBe(true);
    expect(logical.sourceIndex).toBeUndefined();
    expect(backed.identity).toMatchObject({
      manifestDigest: backed.manifest.digest,
      sourceRevision: "revision-1",
      sourceDigest: backed.project?.provenance.sourceDigest,
    });
    expect(
      (await logical.catalog()).items.every(
        ({ sourceAvailability }) => sourceAvailability === "unavailable",
      ),
    ).toBe(true);
    expect(
      (await backed.catalog()).items.some(
        ({ sourceAvailability }) => sourceAvailability === "available",
      ),
    ).toBe(true);
  });

  test("accepts structurally supported snapshots from another analyzer patch version", () => {
    const { fixture, snapshot } = project();
    const older = structuredClone(snapshot);
    for (const provenance of [
      older.provenance,
      older.applicationIndex.provenance,
      older.sourceIndex.provenance,
    ]) {
      (provenance.analyzer as { version: string }).version = "1.0.0-beta.6";
    }

    expect(() => validateApplicationProjectAnalysis(older)).not.toThrow();
    const analysis = trustedFacade(fixture, older);
    expect(analysis.identity.analyzerVersion).toBe(
      snapshot.applicationIndex.provenance.analyzer.version,
    );
    expect(analysis.index).toEqual(snapshot.applicationIndex);
    expect(analysis.project?.applicationIndex.provenance.analyzer.version).toBe("1.0.0-beta.6");
  });

  test("accepts manifest diagnostics independently of their producer ordering", () => {
    const fixture = applicationProjectFixture();
    try {
      const diagnostics: ApplicationDiagnostic[] = [
        {
          severity: "warning",
          code: "UNLOWERED_REACTION",
          definition: { kind: "reaction", name: "RecordNote" },
          message: "warning sorts after info in the project snapshot",
        },
        {
          severity: "info",
          code: "OPAQUE_PATTERN",
          definition: { kind: "reaction", name: "RecordNote" },
          message: "info sorts before warning in the project snapshot",
        },
      ];
      const manifest = fixture.manifest as {
        diagnostics: ApplicationDiagnostic[];
        digest: string;
      };
      manifest.diagnostics = diagnostics;
      manifest.digest = applicationManifestDigest(fixture.manifest);
      const snapshot = loadApplicationProject(fixtureOptions(fixture));

      expect(snapshot.manifestDiagnostics.map(({ severity }) => severity)).toEqual([
        "info",
        "warning",
      ]);
      expect(() => trustedFacade(fixture, snapshot)).not.toThrow();
    } finally {
      fixture.cleanup();
    }
  });

  test("rejects malformed manifests and project snapshots before constructing a facade", () => {
    const { fixture, snapshot } = project();
    const stale = structuredClone(snapshot);
    (stale.applicationIndex.edges as unknown[]).pop();
    expect(() =>
      createApplicationAnalysis({
        manifest: fixture.manifest,
        project: stale,
        expectedProjectDigest: applicationProjectAnalysisDigest(snapshot),
      }),
    ).toThrow(expect.objectContaining({ code: "SNAPSHOT_MISMATCH" }));

    const malformed = structuredClone(fixture.manifest);
    malformed.digest = "stale";
    expect(() => createApplicationAnalysis({ manifest: malformed })).toThrow(
      expect.objectContaining({ code: "INVALID_FORMAT" }),
    );
  });

  test("rejects a structurally self-consistent project index with phantom manifest refs", () => {
    const { fixture, snapshot } = project();
    const forged = structuredClone(snapshot);
    const phantom: DesignRef = { kind: "concept", concept: "Phantom" };
    (forged.applicationIndex.inventory as DesignRef[]).push(phantom);
    (forged.applicationIndex.nodes as DesignRef[]).push(phantom);
    const byRef = (left: DesignRef, right: DesignRef): number => {
      const leftKey = designRefKey(left);
      const rightKey = designRefKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    };
    (forged.applicationIndex.inventory as DesignRef[]).sort(byRef);
    (forged.applicationIndex.nodes as DesignRef[]).sort(byRef);
    (forged.applicationIndex.resourceUsage as { graphNodes: number }).graphNodes += 1;
    (forged.sourceIndex.entries as unknown as Array<{ ref: DesignRef; sources: [] }>).push({
      ref: phantom,
      sources: [],
    });
    (forged.sourceIndex.entries as unknown as Array<{ ref: DesignRef }>).sort((left, right) =>
      byRef(left.ref, right.ref),
    );
    (forged.resourceUsage as { graphNodes: number }).graphNodes += 1;

    expect(() => validateApplicationProjectAnalysis(forged)).not.toThrow();
    expect(() => trustedFacade(fixture, forged)).toThrow(
      expect.objectContaining({ code: "SNAPSHOT_MISMATCH" }),
    );
  });

  test("authenticates the complete project artifact only against a caller-held digest", async () => {
    const { fixture, snapshot } = project();
    const expectedProjectDigest = applicationProjectAnalysisDigest(snapshot);
    expect(() =>
      createApplicationAnalysis({ manifest: fixture.manifest, project: snapshot } as never),
    ).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
    expect(() =>
      createApplicationAnalysis({
        manifest: fixture.manifest,
        project: snapshot,
        expectedProjectDigest: "0".repeat(64),
      }),
    ).toThrow(expect.objectContaining({ code: "SNAPSHOT_MISMATCH" }));

    const altered = structuredClone(snapshot);
    const action = altered.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "action" && ref.concept === "Notes" && ref.action === "add",
    )!;
    const query = altered.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "query" && ref.concept === "Notes" && ref.query === "_all",
    )!;
    const actionSources = action.sources;
    const querySources = query.sources;
    (action as { sources: typeof action.sources }).sources = querySources;
    (query as { sources: typeof query.sources }).sources = actionSources;
    expect(() => validateApplicationProjectAnalysis(altered)).not.toThrow();

    expect(() =>
      createApplicationAnalysis({
        manifest: fixture.manifest,
        project: altered,
        expectedProjectDigest,
      }),
    ).toThrow(expect.objectContaining({ code: "SNAPSHOT_MISMATCH" }));

    const alteredDigest = applicationProjectAnalysisDigest(altered);
    const explicitlyTrusted = createApplicationAnalysis({
      manifest: fixture.manifest,
      project: altered,
      expectedProjectDigest: alteredDigest,
    });
    expect(explicitlyTrusted.identity.analysisDigest).toBe(alteredDigest);
    expect((await explicitlyTrusted.sources({ query: { kind: "ref", ref: add } })).items).toEqual(
      expect.arrayContaining(querySources.map((anchor) => expect.objectContaining({ anchor }))),
    );
  });

  test("uses caller limits for exact canonical index recomputation", () => {
    const { fixture, snapshot } = project();
    const graphNodes = snapshot.applicationIndex.resourceUsage.graphNodes;
    const expectedProjectDigest = applicationProjectAnalysisDigest(snapshot);
    expect(() =>
      createApplicationAnalysis({
        manifest: fixture.manifest,
        project: snapshot,
        expectedProjectDigest,
        limits: { maxGraphNodes: graphNodes - 1 },
      }),
    ).toThrow(AnalysisLimitError);
    expect(
      createApplicationAnalysis({
        manifest: fixture.manifest,
        project: snapshot,
        expectedProjectDigest,
        limits: { maxGraphNodes: graphNodes },
      }).index.resourceUsage.graphNodes,
    ).toBe(graphNodes);
  });

  test("catalogs, searches, describes, and queries source evidence", async () => {
    const { fixture, snapshot } = project();
    const analysis = trustedFacade(fixture, snapshot);

    const first = await analysis.catalog({ page: { limit: 2 } });
    expect(first.items.map(({ key }) => key)).toEqual(first.items.map(({ key }) => key).sort());
    expect(first.nextOffset).toBe(2);
    expect((await analysis.catalog({ filters: { kinds: ["action"] } })).items).toContainEqual(
      expect.objectContaining({ ref: add }),
    );

    const exact = await analysis.search({ query: "Notes.add", fields: ["identity"] });
    expect(exact.items[0]).toMatchObject({ ref: add, rank: 0, matchedField: "identity" });
    const sourceSearch = await analysis.search({
      query: "domain/src/notes.ts",
      fields: ["source-path"],
    });
    expect(sourceSearch.total).toBeGreaterThan(0);

    const description = await analysis.describe({ ref: designRefKey(add), detail: "definition" });
    expect(description.definition?.kind).toBe("action");
    expect(description).not.toHaveProperty("format");
    expect(Object.isFrozen(description)).toBe(true);

    const sources = await analysis.sources({ query: { kind: "ref", ref: add } });
    expect(sources.items.length).toBeGreaterThan(0);
    expect(sources.items[0].anchor).not.toHaveProperty("text");
    const range = sources.items[0].anchor.range;
    expect(
      (
        await analysis.sources({
          query: { kind: "cursor", path: range.path, offset: range.start.offset },
          match: "best",
        })
      ).items.length,
    ).toBeGreaterThan(0);
  });

  test("traces impact, navigates, and exposes neutral diagnostics and provenance", async () => {
    const { fixture, snapshot } = project();
    const analysis = trustedFacade(fixture, snapshot);

    const impact = await analysis.impact({ seeds: [add], maxDepth: 3 });
    expect(impact.trace.seeds).toEqual([add]);
    expect(impact).not.toHaveProperty("context");
    const navigation = await analysis.navigate({ ref: add, direction: "outgoing", maxDepth: 2 });
    expect(navigation.nodes.some(({ ref }) => ref.kind === "reaction")).toBe(true);
    const limited = await analysis.navigate({ ref: add, maxNodes: 1 });
    expect(limited.complete).toBe(false);
    expect(limited.diagnostics[0].code).toBe("NAVIGATION_LIMIT_REACHED");

    const diagnostics = await analysis.diagnostics({ filters: { origins: ["typescript"] } });
    expect(diagnostics.items).toContainEqual(expect.objectContaining({ code: "2322" }));
    const provenance = await analysis.provenance({ page: { limit: 1 } });
    expect(provenance.facts.project).toMatchObject({
      sourceRevision: "revision-1",
      tsconfigPath: "tsconfig.json",
    });
    expect(provenance.items).toHaveLength(1);
    expect(await analysis.contracts()).toMatchObject({ appWide: [], total: 0 });

    expect(Object.keys(analysis).sort()).toEqual(
      [
        "catalog",
        "contracts",
        "describe",
        "diagnostics",
        "identity",
        "impact",
        "index",
        "manifest",
        "navigate",
        "project",
        "provenance",
        "search",
        "sourceIndex",
        "sources",
      ].sort(),
    );
  });

  test("enforces request, cancellation, capability, page, and result byte bounds", async () => {
    const { fixture, snapshot } = project();
    const analysis = trustedFacade(fixture, snapshot);
    const logical = createApplicationAnalysis({ manifest: fixture.manifest });
    const abort = new AbortController();
    abort.abort("stop");

    const failures: readonly [string, Promise<unknown>, string][] = [
      ["page", analysis.catalog({ page: { limit: 0 } }), "INVALID_ARGUMENT"],
      ["page maximum", analysis.catalog({ page: { limit: 201 } }), "LIMIT_EXCEEDED"],
      ["result", analysis.catalog({ maxResultBytes: 1 }), "LIMIT_EXCEEDED"],
      ["abort", analysis.catalog({ signal: abort.signal }), "ABORTED"],
      ["blank search", analysis.search({ query: " " }), "INVALID_ARGUMENT"],
      ["unknown ref", analysis.describe({ ref: { ...add, action: "missing" } }), "NOT_FOUND"],
      [
        "source unavailable",
        logical.sources({ query: { kind: "ref", ref: add } }),
        "CAPABILITY_UNAVAILABLE",
      ],
      [
        "context removed",
        analysis.impact({ seeds: [add], detail: "context" } as never),
        "INVALID_ARGUMENT",
      ],
    ];
    for (const [label, pending, code] of failures) {
      await expect(pending, label).rejects.toSatisfy(expectCode(code));
    }

    const facade = analysis as ApplicationAnalysis & Record<string, unknown>;
    expect(facade.guidance).toBeUndefined();
    expect(facade.target).toBeUndefined();
    expect(facade.reviewChange).toBeUndefined();
  });

  test("rejects malformed retained operation inputs", async () => {
    const { fixture, snapshot } = project();
    const analysis = trustedFacade(fixture, snapshot);
    const invalid: readonly [string, () => Promise<unknown>, string][] = [
      ["request object", () => analysis.catalog([] as never), "INVALID_ARGUMENT"],
      ["signal", () => analysis.catalog({ signal: {} as never }), "INVALID_ARGUMENT"],
      [
        "kind collection",
        () => analysis.catalog({ filters: { kinds: "action" as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "concept collection",
        () => analysis.catalog({ filters: { concepts: [""] } }),
        "INVALID_ARGUMENT",
      ],
      [
        "kind value",
        () => analysis.catalog({ filters: { kinds: ["invalid" as never] } }),
        "INVALID_ARGUMENT",
      ],
      ["search type", () => analysis.search({ query: 1 as never }), "INVALID_ARGUMENT"],
      ["search fields", () => analysis.search({ query: "Notes", fields: [] }), "INVALID_ARGUMENT"],
      [
        "removed source-text field",
        () => analysis.search({ query: "Notes", fields: ["source-text"] as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "removed full description",
        () => analysis.describe({ ref: add, detail: "full" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "reference shape",
        () => analysis.describe({ ref: { ...add, extra: true } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "source path",
        () => analysis.sources({ query: { kind: "file", path: "/absolute.ts" } }),
        "INVALID_ARGUMENT",
      ],
      [
        "source range",
        () =>
          analysis.sources({
            query: { kind: "range", path: "src/app.ts", start: 2, end: 1 },
          }),
        "INVALID_ARGUMENT",
      ],
      ["impact seeds", () => analysis.impact({ seeds: [] }), "INVALID_ARGUMENT"],
      [
        "impact relations",
        () => analysis.impact({ seeds: [add], relations: "action-trigger" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "diagnostic prefixes",
        () => analysis.diagnostics({ filters: { pathPrefixes: ["../src"] } }),
        "INVALID_ARGUMENT",
      ],
      [
        "contract endpoint",
        () => analysis.contracts({ filters: { endpoints: ["missing"] } }),
        "NOT_FOUND",
      ],
      [
        "contract rendering",
        () => analysis.contracts({ detail: "rendered" } as never),
        "INVALID_ARGUMENT",
      ],
    ];
    for (const [label, run, code] of invalid) {
      await expect(run(), label).rejects.toSatisfy(expectCode(code));
    }
  });
});
