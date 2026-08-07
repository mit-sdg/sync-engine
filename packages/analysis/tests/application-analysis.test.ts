import { createHash } from "node:crypto";
import {
  applicationManifestDigest,
  type ApplicationManifestV5,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisError,
  applicationAnalysisResultDigest,
  createApplicationAnalysis,
  indexApplication,
  indexApplicationSources,
  parseApplicationAnalysisResult,
  parseDesignRefKey,
  queryApplicationSources,
  renderApplicationAnalysisResult,
  validateApplicationAnalysisResult,
  type ApplicationProjectAnalysis,
  type DesignRef,
  type SourceAnchor,
  type SourceResolution,
  type SourceRole,
} from "@mit-sdg/sync-engine-analysis/tooling";
import { loadGuidanceResource, selectGuidance } from "@mit-sdg/sync-engine-analysis/guidance";
import { describe, expect, test } from "vite-plus/test";
import ts from "typescript";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function redigest(manifest: ApplicationManifestV5): ApplicationManifestV5 {
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

function fixture(after = false): ApplicationManifestV5 {
  return redigest({
    format: "sync-engine.application-manifest",
    version: 5,
    generator: { name: "@mit-sdg/sync-engine", version: "1.0.0-beta.7" },
    digest: "pending",
    concepts: [
      {
        name: "RequestBoundary",
        actions: [
          { name: "request", roles: ["path", "requestId"] },
          { name: "respond", roles: ["requestId"] },
        ],
        queries: [],
      },
      {
        name: "Todos",
        purpose: "Keep named todos.",
        principle: "A named todo can be recorded.",
        actions: [{ name: "add", roles: after ? ["tag", "title"] : ["title"] }],
        queries: [{ name: "_all", roles: [], returns: "many" }],
      },
    ],
    conceptImplementations: [
      {
        concept: "RequestBoundary",
        canonical: { owner: "core", constructorName: "RequestBoundaryConcept" },
        selected: { via: "core" },
      },
      {
        concept: "Todos",
        canonical: { owner: "application", constructorName: "TodosConcept" },
        selected: { via: "default" },
      },
    ],
    computations: [
      { name: "among", source: "standard" },
      { name: "ge", source: "standard", inputs: ["left", "right"] },
      { name: "gt", source: "standard" },
      { name: "le", source: "standard" },
      { name: "lt", source: "standard" },
      { name: "normalize", source: "vocabulary", inputs: ["value"] },
    ],
    application: {
      reactions: [
        {
          name: "OnAdd",
          when: [
            {
              kind: "action",
              concept: "Todos",
              action: "add",
              posture: "returned",
              input: { title: { $var: "title" } },
              output: {},
            },
          ],
          where: [],
          then: [],
        },
        {
          name: "AddEndpoint",
          when: [],
          where: [],
          then: [],
        },
      ],
      unlowered: [
        {
          name: "LocalTodo",
          reason: "captures local code",
          known: {
            when: [
              {
                kind: "action",
                concept: "Todos",
                action: "add",
                input: {},
                output: {},
              },
            ],
            where: [],
            then: [],
            patterns: [],
          },
        },
      ],
      views: [
        {
          name: "todo view",
          ins: [],
          outs: ["title"],
          bindings: [],
          promise: "many",
          alternatives: [
            [
              {
                op: "find",
                query: { concept: "Todos", query: "_all" },
                in: {},
                out: { title: { $var: "title" } },
              },
            ],
          ],
        },
      ],
      formers: [
        {
          name: "todo shape",
          ins: [],
          bindings: ["title"],
          promise: "optional",
          body: {
            node: "record",
            where: [
              {
                op: "find",
                view: "todo view",
                in: {},
                out: { title: { $var: "title" } },
              },
            ],
            entries: { title: { node: "leaf", var: "title" } },
          },
        },
      ],
    },
    endpoints: [
      {
        name: "AddEndpoint",
        path: "/todos/add",
        reactions: ["AddEndpoint"],
        input: { required: after ? ["tag", "title"] : ["title"] },
        validators: { input: false, output: false },
      },
    ],
    inputContracts: {
      "/todos/add": { required: after ? ["tag", "title"] : ["title"] },
    },
    wire: {
      endpoints: [
        {
          path: "/todos/add",
          input: {
            kind: "object",
            fields: [
              { key: "title", type: { kind: "json" } },
              ...(after ? [{ key: "tag", type: { kind: "json" } } as const] : []),
            ],
          },
          output: { kind: "json" },
          errors: ["INVALID_INPUT"],
          inputAdmissionError: true,
          openError: false,
        },
      ],
      appWide: ["UNAVAILABLE"],
    },
    diagnostics: [
      {
        severity: "info",
        code: "UNLOWERED_REACTION",
        definition: { kind: "reaction", name: "LocalTodo" },
        message: "LocalTodo retains known structure only.",
      },
    ],
  });
}

function source(after = false): string {
  return `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint } from "@mit-sdg/sync-engine/boundary";
import { former, reaction, view, vocabulary } from "@mit-sdg/sync-engine/language";

export class TodosConcept {
  add({ title }: { title: string }) { const implementationSentinel = ${JSON.stringify(after ? "after" : "before")}; return { title, implementationSentinel }; }
  _all() { return []; }
}
const words = vocabulary({
  concepts: { Todos: { class: TodosConcept } },
  computations: { normalize: ({ value }: { value: string }) => value.trim() },
});
const { Todos } = words.concepts;
export const OnAdd = reaction(() => Todos.add({ title: "one" }));
export const LocalTodo = reaction(() => Todos.add({ title: "local" }));
export const TodoView = view("todo view", () => Todos._all());
export const TodoShape = former("todo shape", () => Todos._all());
export const AddEndpoint = endpoint("/todos/add", () => Todos.add({ title: "endpoint" }));
export const application = assemble({
  vocabulary: words,
  composition: { OnAdd, LocalTodo, TodoView, TodoShape, AddEndpoint },
});
`;
}

function programFor(text: string): ts.Program {
  const path = "/project/app.ts";
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noResolve: true,
  };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (candidate) => candidate === path || base.fileExists(candidate),
    readFile: (candidate) => (candidate === path ? text : base.readFile(candidate)),
    getSourceFile: (candidate, languageVersion) =>
      candidate === path
        ? ts.createSourceFile(candidate, text, languageVersion, false, ts.ScriptKind.TS)
        : base.getSourceFile(candidate, languageVersion),
    getCurrentDirectory: () => "/project",
    writeFile: () => undefined,
  };
  return ts.createProgram({ rootNames: [path], options, host });
}

function project(manifest: ApplicationManifestV5, after = false): ApplicationProjectAnalysis {
  const text = source(after);
  const applicationIndex = indexApplication(manifest);
  const indexedSources = indexApplicationSources({
    manifest,
    program: programFor(text),
    projectRoot: "/project",
  });
  const sourceIndex = {
    ...structuredClone(indexedSources),
    issues: [
      ...indexedSources.issues,
      {
        code: "SPECIFICATION_MISMATCH",
        severity: "error" as const,
        ref: { kind: "concept", concept: "Todos" },
        message: "The source specification differs.",
      } as const,
    ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    resourceUsage: {
      ...indexedSources.resourceUsage,
      diagnostics: indexedSources.resourceUsage.diagnostics + 1,
    },
  };
  const configText = "{}\n";
  const files = [
    ...sourceIndex.documents.map(({ path, digest }) => ({ path, digest })),
    { path: "tsconfig.json", digest: sha256(configText) },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const revision = after ? "revision-after" : "revision-before";
  return {
    format: "sync-engine.application-project-analysis",
    version: 2,
    manifestDigest: manifest.digest,
    provenance: {
      ...applicationIndex.provenance,
      sourceRevision: revision,
      manifestSourceRevision: revision,
      manifestDigest: manifest.digest,
      sourceDigest: sha256(JSON.stringify(files)),
      tsconfigPath: "tsconfig.json",
      typescriptVersion: ts.version,
      projectReferences: [],
      files,
    },
    diagnostics: [
      {
        phase: "semantic",
        severity: "error",
        category: "error",
        code: after ? 9002 : 9001,
        message: after ? "after diagnostic" : "before diagnostic",
        path: "app.ts",
        startOffset: 0,
        endOffset: 1,
        line: 1,
        column: 1,
      },
    ],
    manifestDiagnostics: manifest.diagnostics,
    applicationIndex,
    sourceIndex,
    resourceUsage: {
      graphNodes: applicationIndex.resourceUsage.graphNodes,
      graphEdges: applicationIndex.resourceUsage.graphEdges,
      diagnostics:
        applicationIndex.issues.length +
        sourceIndex.issues.length +
        manifest.diagnostics.length +
        1,
      sourceDocuments: sourceIndex.resourceUsage.sourceDocuments,
      sourceAnchors: sourceIndex.resourceUsage.sourceAnchors,
      sourceTextBytes: sourceIndex.resourceUsage.sourceTextBytes,
      astNodes: sourceIndex.resourceUsage.astNodes,
      projectFiles: files.length,
      projectBytes: Buffer.byteLength(text, "utf8") + Buffer.byteLength(configText, "utf8"),
    },
  };
}

const add: DesignRef = { kind: "action", concept: "Todos", action: "add" };
const SOURCE_ROLES = [
  "declaration",
  "canonical-contract",
  "selected-implementation",
  "selection",
  "registration",
  "specification",
] as const satisfies readonly SourceRole[];
const SOURCE_RESOLUTIONS = [
  "symbol",
  "static-flow",
  "literal-name",
  "name-and-footprint",
  "manifest-location",
  "manifest-provenance",
] as const satisfies readonly SourceResolution[];

function sourceAnchorKey(anchor: SourceAnchor): string {
  return JSON.stringify([
    anchor.role,
    anchor.range.path,
    anchor.range.start.offset,
    anchor.range.end.offset,
    anchor.focusRange?.start.offset ?? -1,
    anchor.focusRange?.end.offset ?? -1,
    anchor.resolution,
  ]);
}

function projectWithSourceFilterMatrix(
  manifest: ApplicationManifestV5,
): ApplicationProjectAnalysis {
  const snapshot = project(manifest);
  const entry = snapshot.sourceIndex.entries.find(
    ({ ref }) => ref.kind === "action" && ref.concept === "Todos" && ref.action === "add",
  );
  const base = entry?.sources[0];
  if (entry === undefined || base === undefined)
    throw new Error("source fixture omitted Todos.add");
  const sources = SOURCE_ROLES.flatMap((role) =>
    SOURCE_RESOLUTIONS.map((resolution): SourceAnchor => ({ ...base, role, resolution })),
  ).sort((left, right) => {
    const leftKey = sourceAnchorKey(left);
    const rightKey = sourceAnchorKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  (entry as unknown as { sources: SourceAnchor[] }).sources = sources;

  const anchors = snapshot.sourceIndex.entries.flatMap((candidate) => candidate.sources);
  const sourceUsage = snapshot.sourceIndex.resourceUsage as {
    sourceAnchors: number;
    sourceTextBytes: number;
  };
  sourceUsage.sourceAnchors = anchors.length;
  sourceUsage.sourceTextBytes = anchors.reduce(
    (total, anchor) => total + Buffer.byteLength(anchor.text, "utf8"),
    0,
  );
  const projectUsage = snapshot.resourceUsage as {
    sourceAnchors: number;
    sourceTextBytes: number;
  };
  projectUsage.sourceAnchors = sourceUsage.sourceAnchors;
  projectUsage.sourceTextBytes = sourceUsage.sourceTextBytes;
  return snapshot;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (caught) => caught instanceof AnalysisError && caught.code === code;
}

function expectThrowsCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AnalysisError);
  expect(caught).toMatchObject({ code });
}

describe("application analysis facade", () => {
  test("serializes stable analysis errors without retaining unsafe caller data", () => {
    const callerData = { nested: { value: 1 } };
    const failure = new AnalysisError("INVALID_ARGUMENT", "controlled failure", callerData);
    callerData.nested.value = 2;
    expect(failure.toJSON()).toEqual({
      name: "AnalysisError",
      code: "INVALID_ARGUMENT",
      message: "controlled failure",
      data: { nested: { value: 1 } },
    });
    expect(Object.isFrozen(failure.data)).toBe(true);
    expect(new AnalysisError("ABORTED", "without data").toJSON()).not.toHaveProperty("data");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(new AnalysisError("INVALID_ARGUMENT", "cyclic", cyclic).data).toEqual({
      detail: "[object Object]",
    });
    expect(
      new AnalysisError("INVALID_ARGUMENT", "non-serializing", (() => undefined) as never).data,
    ).toEqual({ detail: "() => undefined" });
  });

  test("creates detached frozen manifest-only and project-backed snapshots", async () => {
    const manifest = fixture();
    const projectSnapshot = project(manifest);
    const logical = createApplicationAnalysis({ manifest });
    const backed = createApplicationAnalysis({ manifest, project: projectSnapshot });

    manifest.concepts.find(({ name }) => name === "Todos")!.purpose = "mutated caller value";
    (projectSnapshot.provenance as { sourceRevision: string }).sourceRevision = "mutated";
    expect(logical.manifest.concepts.find(({ name }) => name === "Todos")?.purpose).toBe(
      "Keep named todos.",
    );
    expect(backed.project?.provenance.sourceRevision).toBe("revision-before");
    expect(Object.isFrozen(backed)).toBe(true);
    expect(Object.isFrozen(backed.manifest.concepts[0].actions)).toBe(true);
    expect(Object.isFrozen(backed.project?.sourceIndex.entries[0].sources)).toBe(true);
    expect(logical.sourceIndex).toBeUndefined();
    expect(backed.identity).toMatchObject({
      manifestDigest: backed.manifest.digest,
      sourceRevision: "revision-before",
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

  test("rejects stale project, index, source, and manifest compositions exactly", () => {
    const manifest = fixture();
    const staleIndex = project(manifest);
    (staleIndex.applicationIndex.edges as unknown as unknown[]).pop();
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest, project: staleIndex }),
      "SNAPSHOT_MISMATCH",
    );

    const staleSource = project(manifest);
    (staleSource.sourceIndex as { manifestDigest: string }).manifestDigest = "stale";
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest, project: staleSource }),
      "SNAPSHOT_MISMATCH",
    );

    const staleManifest = fixture();
    staleManifest.digest = "stale";
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest: staleManifest }),
      "INVALID_FORMAT",
    );

    const unsupportedManifestFormat = fixture() as unknown as { format: string };
    unsupportedManifestFormat.format = "other";
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest: unsupportedManifestFormat as never }),
      "INVALID_FORMAT",
    );
    const unsupportedManifestVersion = fixture() as unknown as { version: number };
    unsupportedManifestVersion.version = 4;
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest: unsupportedManifestVersion as never }),
      "UNSUPPORTED_VERSION",
    );
    const unsupportedProjectFormat = project(manifest) as unknown as { format: string };
    unsupportedProjectFormat.format = "other";
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest, project: unsupportedProjectFormat as never }),
      "INVALID_FORMAT",
    );
    const unsupportedProjectVersion = project(manifest) as unknown as { version: number };
    unsupportedProjectVersion.version = 1;
    expectThrowsCode(
      () => createApplicationAnalysis({ manifest, project: unsupportedProjectVersion as never }),
      "UNSUPPORTED_VERSION",
    );
  });

  test("strictly parses every design reference key", () => {
    const refs: DesignRef[] = [
      { kind: "concept", concept: "Todos" },
      add,
      { kind: "query", concept: "Todos", query: "_all" },
      { kind: "reaction", reaction: "OnAdd" },
      { kind: "view", view: "todo view" },
      { kind: "former", former: "todo shape" },
      { kind: "computation", computation: "normalize" },
      { kind: "endpoint", endpoint: "AddEndpoint", path: "/todos/add" },
    ];
    for (const ref of refs)
      expect(parseDesignRefKey(JSON.stringify(Object.values(ref)))).toEqual(ref);
    for (const malformed of [
      "not json",
      JSON.stringify({ kind: "concept", concept: "Todos" }),
      JSON.stringify(["unknown", "x"]),
      JSON.stringify(["concept"]),
      JSON.stringify(["concept", ""]),
      JSON.stringify(["action", "Todos", 1]),
    ]) {
      expectThrowsCode(() => parseDesignRefKey(malformed), "INVALID_ARGUMENT");
    }
    expectThrowsCode(() => parseDesignRefKey(1 as never), "INVALID_ARGUMENT");
  });

  test("catalogs all kinds with deterministic filters and snapshot-safe pages", async () => {
    const analysis = createApplicationAnalysis({
      manifest: fixture(),
      project: project(fixture()),
    });
    const first = await analysis.catalog({ page: { limit: 3 } });
    const second = await analysis.catalog({ page: { offset: first.nextOffset!, limit: 3 } });
    expect(first.items.map(({ key }) => key)).toEqual(first.items.map(({ key }) => key).sort());
    expect(new Set([...first.items, ...second.items].map(({ key }) => key)).size).toBe(6);
    expect(first.total).toBeGreaterThanOrEqual(9);
    expect(
      (
        await analysis.catalog({
          filters: {
            kinds: ["reaction", "reaction"],
            portability: ["unlowered", "unlowered"],
            diagnosticSeverities: ["info"],
          },
        })
      ).items.map(({ name }) => name),
    ).toEqual(["LocalTodo"]);
    expect(
      (
        await analysis.catalog({
          filters: { concepts: ["Todos"], sourceAvailability: ["available"] },
        })
      ).items.every(
        ({ parentConcept, ref }) => parentConcept === "Todos" || ref.kind === "concept",
      ),
    ).toBe(true);
    await expect(
      analysis.catalog({ filters: { kinds: ["invalid" as "concept"] } }),
    ).rejects.toSatisfy(expectCode("INVALID_ARGUMENT"));
  });

  test("requires positive bounded page limits for every paged facade operation", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const zeroLimitOperations: readonly [string, () => Promise<unknown>][] = [
      ["catalog", () => analysis.catalog({ page: { limit: 0 } })],
      ["search", () => analysis.search({ query: "Todos", page: { limit: 0 } })],
      ["sources", () => analysis.sources({ query: { kind: "ref", ref: add }, page: { limit: 0 } })],
      ["diagnostics", () => analysis.diagnostics({ page: { limit: 0 } })],
      ["guidance", () => analysis.guidance({ page: { limit: 0 } })],
      ["contracts", () => analysis.contracts({ page: { limit: 0 } })],
      ["provenance", () => analysis.provenance({ page: { limit: 0 } })],
    ];
    for (const [operation, invoke] of zeroLimitOperations) {
      await expect(invoke(), operation).rejects.toSatisfy(expectCode("INVALID_ARGUMENT"));
    }
    for (const [limit, code] of [
      [-1, "INVALID_ARGUMENT"],
      [Number.MAX_SAFE_INTEGER + 1, "INVALID_ARGUMENT"],
      [201, "LIMIT_EXCEEDED"],
    ] as const) {
      await expect(analysis.catalog({ page: { limit } })).rejects.toSatisfy(expectCode(code));
    }

    const first = await analysis.catalog({ page: { limit: 1 } });
    expect(first.nextOffset).toBeGreaterThan(0);
    const nonAdvancing = structuredClone(first);
    (nonAdvancing.items as unknown[]).splice(0);
    (nonAdvancing as { nextOffset: number | null }).nextOffset = 0;
    expectThrowsCode(() => validateApplicationAnalysisResult(nonAdvancing), "INVALID_FORMAT");
  });

  test("strictly validates operation requests, filters, and hard bounds", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const logical = createApplicationAnalysis({ manifest });
    const tooManyRefs = Array.from({ length: 101 }, () => add);
    const cyclicProjection: unknown[] = [];
    cyclicProjection.push(cyclicProjection);

    const invalid: readonly [string, () => Promise<unknown>, string][] = [
      ["null catalog request", () => analysis.catalog(null as never), "INVALID_ARGUMENT"],
      [
        "unsupported catalog field",
        () => analysis.catalog({ unsupported: true } as never),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid operation signal",
        () => analysis.catalog({ signal: {} as AbortSignal }),
        "INVALID_ARGUMENT",
      ],
      [
        "null catalog filters",
        () => analysis.catalog({ filters: null as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "unsupported catalog filter",
        () => analysis.catalog({ filters: { unsupported: [] } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array enum filter",
        () => analysis.catalog({ filters: { kinds: "reaction" as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array string filter",
        () => analysis.catalog({ filters: { concepts: "Todos" as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "empty string filter",
        () => analysis.catalog({ filters: { concepts: [""] } }),
        "INVALID_ARGUMENT",
      ],
      ["null page", () => analysis.catalog({ page: null as never }), "INVALID_ARGUMENT"],
      [
        "unsupported page field",
        () => analysis.catalog({ page: { limit: 1, unsupported: true } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "negative page offset",
        () => analysis.catalog({ page: { offset: -1 } }),
        "INVALID_ARGUMENT",
      ],
      ["non-string search", () => analysis.search({ query: 1 as never }), "INVALID_ARGUMENT"],
      ["blank search", () => analysis.search({ query: "   " }), "INVALID_ARGUMENT"],
      [
        "empty search fields",
        () => analysis.search({ query: "Todos", fields: [] }),
        "INVALID_ARGUMENT",
      ],
      [
        "unknown search field",
        () => analysis.search({ query: "Todos", fields: ["unknown" as never] }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-object design ref",
        () => analysis.describe({ ref: null as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "unknown design ref kind",
        () => analysis.describe({ ref: { kind: "unknown" } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "extra design ref field",
        () => analysis.describe({ ref: { ...add, extra: true } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "empty design ref field",
        () => analysis.describe({ ref: { ...add, action: "" } }),
        "INVALID_ARGUMENT",
      ],
      [
        "unknown description detail",
        () => analysis.describe({ ref: add, detail: "unknown" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "source capability unavailable",
        () => logical.sources({ query: { kind: "ref", ref: add } }),
        "CAPABILITY_UNAVAILABLE",
      ],
      [
        "non-object source query",
        () => analysis.sources({ query: null as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "reversed source query",
        () => analysis.sources({ query: { kind: "range", path: "app.ts", start: 2, end: 1 } }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid source role",
        () => analysis.sources({ query: { kind: "ref", ref: add }, roles: ["unknown" as never] }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid source resolution",
        () =>
          analysis.sources({
            query: { kind: "ref", ref: add },
            resolutions: ["unknown" as never],
          }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid source content",
        () =>
          analysis.sources({
            query: { kind: "ref", ref: add },
            content: "unknown" as never,
          }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid source match",
        () => analysis.sources({ query: { kind: "ref", ref: add }, match: "unknown" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "unsupported diagnostics filter",
        () => analysis.diagnostics({ filters: { unsupported: [] } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array diagnostic refs",
        () => analysis.diagnostics({ filters: { refs: add as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array path prefixes",
        () => analysis.diagnostics({ filters: { pathPrefixes: "app" as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid path prefix",
        () => analysis.diagnostics({ filters: { pathPrefixes: ["/app"] } }),
        "INVALID_ARGUMENT",
      ],
      [
        "unsupported guidance filter",
        () => analysis.guidance({ filters: { unsupported: [] } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid guidance topic",
        () => analysis.guidance({ filters: { topics: ["unknown" as never] } }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array guidance diagnostics",
        () => analysis.guidance({ filters: { diagnosticIds: "id" as never } }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array impact seeds",
        () => analysis.impact({ seeds: add as never }),
        "INVALID_ARGUMENT",
      ],
      ["too many impact seeds", () => analysis.impact({ seeds: tooManyRefs }), "LIMIT_EXCEEDED"],
      [
        "unknown impact detail",
        () => analysis.impact({ seeds: [add], detail: "unknown" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "impact depth bound",
        () => analysis.impact({ seeds: [add], maxDepth: 13 }),
        "LIMIT_EXCEEDED",
      ],
      [
        "invalid impact nodes",
        () => analysis.impact({ seeds: [add], maxNodes: 0 }),
        "INVALID_ARGUMENT",
      ],
      [
        "non-array impact relations",
        () => analysis.impact({ seeds: [add], relations: "action-trigger" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid impact certainty",
        () => analysis.impact({ seeds: [add], certainties: ["unknown" as never] }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid navigation direction",
        () => analysis.navigate({ ref: add, direction: "unknown" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid navigation edges",
        () => analysis.navigate({ ref: add, maxEdges: -1 }),
        "INVALID_ARGUMENT",
      ],
      [
        "navigation edge bound",
        () => analysis.navigate({ ref: add, maxEdges: 5_001 }),
        "LIMIT_EXCEEDED",
      ],
      [
        "invalid target source kind",
        () => analysis.target({ source: { kind: "file", path: "app.ts" } as never }),
        "INVALID_ARGUMENT",
      ],
      ["empty target", () => analysis.target({}), "NOT_FOUND"],
      [
        "unmatched target range",
        () => analysis.target({ source: { kind: "cursor", path: "app.ts", offset: 99_999 } }),
        "NOT_FOUND",
      ],
      ["too many target refs", () => analysis.target({ refs: tooManyRefs }), "LIMIT_EXCEEDED"],
      [
        "unknown contract detail",
        () => analysis.contracts({ detail: "unknown" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "unsupported contract filter",
        () => analysis.contracts({ filters: { unsupported: [] } as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "unknown contract endpoint",
        () => analysis.contracts({ filters: { endpoints: ["missing"] } }),
        "NOT_FOUND",
      ],
      [
        "unknown contract path",
        () => analysis.contracts({ filters: { paths: ["/missing"] } }),
        "NOT_FOUND",
      ],
      [
        "non-array projections",
        () => analysis.contracts({ projections: {} as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "cyclic projections",
        () => analysis.contracts({ projections: cyclicProjection as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "primitive projection",
        () => analysis.contracts({ projections: [1] as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "malformed projection wire",
        () =>
          analysis.contracts({
            projections: [
              {
                name: "fixture",
                provenance: { name: "fixture", version: "1" },
                wire: { endpoints: {}, appWide: [] },
              },
            ] as never,
          }),
        "INVALID_ARGUMENT",
      ],
      [
        "unsupported provenance request",
        () => analysis.provenance({ unsupported: true } as never),
        "INVALID_ARGUMENT",
      ],
      ["foreign review facade", () => analysis.reviewChange({} as never), "INVALID_ARGUMENT"],
      [
        "non-array review paths",
        () => analysis.reviewChange(logical, { changedPaths: "app.ts" as never }),
        "INVALID_ARGUMENT",
      ],
      [
        "invalid review path",
        () => analysis.reviewChange(logical, { changedPaths: ["../app.ts"] }),
        "INVALID_ARGUMENT",
      ],
      [
        "review change bound",
        () => analysis.reviewChange(logical, { maxChanges: 10_001 }),
        "LIMIT_EXCEEDED",
      ],
    ];

    for (const [label, invoke, code] of invalid) {
      await expect(invoke(), label).rejects.toSatisfy(expectCode(code));
    }
  });

  test("supports string refs, ranked search modes, edge bounds, and optional contract rendering", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const key = JSON.stringify(["action", "Todos", "add"]);

    expect((await analysis.describe({ ref: key, detail: "summary" })).summary.ref).toEqual(add);
    for (const [query, fields, rank] of [
      ["add", ["identity"], 1],
      ["Tod", ["identity"], 2],
      ["Todos add", ["identity"], 3],
      ["app.ts", ["source-path"], 4],
      ["required", ["contract"], 5],
      ["/todos/add", ["rendered"], 5],
    ] as const) {
      const result = await analysis.search({ query, fields: [...fields] });
      expect(
        result.items.some((item) => item.rank === rank),
        query,
      ).toBe(true);
    }

    expect(
      (
        await analysis.diagnostics({
          filters: { codes: ["9001"], pathPrefixes: ["app", "app/"] },
        })
      ).items.map(({ code }) => code),
    ).toEqual(["9001"]);
    const diagnostic = (await analysis.diagnostics()).items[0];
    expect(
      (
        await analysis.guidance({
          filters: {
            topics: ["sources", "provenance"],
            refs: [key],
            diagnosticIds: diagnostic === undefined ? [] : [diagnostic.id],
          },
        })
      ).items.every(({ topic }) => topic === "sources" || topic === "provenance"),
    ).toBe(true);
    expect(
      (
        await analysis.impact({
          seeds: [key],
          relations: ["action-trigger", "same-concept-state"],
          certainties: ["structural", "conservative"],
        })
      ).trace.affected.length,
    ).toBeGreaterThan(0);
    expect((await analysis.navigate({ ref: key, direction: "incoming" })).direction).toBe(
      "incoming",
    );
    const noEdges = await analysis.navigate({ ref: key, maxEdges: 0 });
    expect(noEdges.complete).toBe(false);
    expect(noEdges.edges).toEqual([]);

    const summary = await analysis.contracts({ detail: "summary" });
    expect(summary.items[0]).not.toHaveProperty("inputContract");
    const data = await analysis.contracts();
    expect(data.items[0]).toHaveProperty("inputContract");
    const rendered = await analysis.contracts({
      detail: "rendered",
      projections: [
        {
          name: "custom-errors",
          provenance: { name: "fixture", version: "1" },
          wire: manifest.wire,
          render: { appWideErrorName: "FixtureAppError" },
        },
      ],
    });
    expect(rendered.rendered?.projections[0].rendered).toContain("FixtureAppError");
    expect((await createApplicationAnalysis({ manifest }).provenance()).facts).not.toHaveProperty(
      "project",
    );
  });

  test("searches token-AND fields with stable ranking and source-text opt-in", async () => {
    const manifest = fixture();
    const backed = createApplicationAnalysis({ manifest, project: project(manifest) });
    const exact = await backed.search({ query: "Todos.add" });
    expect(exact.items[0]).toMatchObject({ ref: add, rank: 0, matchedField: "identity" });
    expect((await backed.search({ query: "todos title" })).items.length).toBeGreaterThan(0);
    expect((await backed.search({ query: "implementationSentinel" })).total).toBe(0);
    const sourceText = await backed.search({
      query: "implementationSentinel",
      fields: ["source-text"],
    });
    expect(sourceText.items[0]).toMatchObject({ matchedField: "source-text" });
    expect(sourceText.items[0].snippet.length).toBeLessThanOrEqual(160);
    const logical = createApplicationAnalysis({ manifest });
    await expect(logical.search({ query: "sentinel", fields: ["source-text"] })).rejects.toSatisfy(
      expectCode("CAPABILITY_UNAVAILABLE"),
    );
    await expect(backed.search({ query: " ".repeat(257) })).rejects.toSatisfy(
      expectCode("INVALID_ARGUMENT"),
    );
  });

  test("describes every definition discriminator at summary, definition, and full detail", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const refs = analysis.index.inventory;
    for (const ref of refs) {
      const description = await analysis.describe({ ref, detail: "definition" });
      expect(description.definition?.kind).toBe(ref.kind);
      expect(description).not.toHaveProperty("sources");
    }
    const endpoint = await analysis.describe({
      ref: { kind: "endpoint", endpoint: "AddEndpoint", path: "/todos/add" },
      detail: "definition",
    });
    expect(endpoint.definition).toMatchObject({
      kind: "endpoint",
      inputContract: { required: ["title"] },
      wire: { endpoints: [{ path: "/todos/add" }], appWide: ["UNAVAILABLE"] },
    });
    const full = await analysis.describe({ ref: add, detail: "full" });
    expect(full.sources?.some(({ text }) => text?.includes("add("))).toBe(true);
    expect(full.diagnostics).toBeDefined();
    await expect(
      createApplicationAnalysis({ manifest }).describe({ ref: add, detail: "full" }),
    ).rejects.toSatisfy(expectCode("CAPABILITY_UNAVAILABLE"));
    await expect(
      analysis.describe({ ref: { kind: "action", concept: "Todos", action: "missing" } }),
    ).rejects.toSatisfy(expectCode("NOT_FOUND"));
  });

  test("queries sources by ref, cursor, range, and file with best ties and issues", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const byRef = await analysis.sources({
      query: { kind: "ref", ref: add },
      content: "text",
    });
    expect(byRef.items[0].text).toContain("add(");
    const anchor = byRef.items[0].metadata.range;
    const cursor = await analysis.sources({
      query: { kind: "cursor", path: anchor.path, offset: anchor.start.offset },
      match: "best",
    });
    expect(cursor.items.length).toBeGreaterThan(0);
    expect(new Set(cursor.items.map(({ rank }) => rank)).size).toBe(1);
    const exact = await analysis.sources({
      query: {
        kind: "range",
        path: anchor.path,
        start: anchor.start.offset,
        end: anchor.end.offset,
      },
    });
    expect(exact.items.some(({ specificity }) => specificity === "focus")).toBe(true);
    expect(
      (await analysis.sources({ query: { kind: "file", path: "app.ts" } })).total,
    ).toBeGreaterThan(0);
    const computation = await analysis.sources({
      query: { kind: "ref", ref: { kind: "computation", computation: "normalize" } },
    });
    expect(computation.items.map(({ role }) => role)).toEqual([
      "declaration",
      "selected-implementation",
    ]);
    expect(computation.issues).toEqual([]);
    expect(
      (
        await analysis.sources({
          query: { kind: "range", path: "app.ts", start: 1, end: 1 },
        })
      ).items,
    ).toEqual([]);
    await expect(
      analysis.sources({ query: { kind: "file", path: "../app.ts" } }),
    ).rejects.toSatisfy(expectCode("INVALID_ARGUMENT"));
  });

  test("filters every source role and resolution identically with stable intersection order", async () => {
    const manifest = fixture();
    const snapshot = projectWithSourceFilterMatrix(manifest);
    const analysis = createApplicationAnalysis({ manifest, project: snapshot });
    const sourceIndex = analysis.sourceIndex!;
    const query = { kind: "ref", ref: add } as const;
    const key = ({ anchor }: { readonly anchor: SourceAnchor }): string =>
      `${anchor.role}\0${anchor.resolution}`;
    const facadeKey = ({
      role,
      resolution,
    }: {
      readonly role: SourceRole;
      readonly resolution: SourceResolution;
    }): string => `${role}\0${resolution}`;

    const all = queryApplicationSources(sourceIndex, query).matches.map(key);
    const reversed = queryApplicationSources(
      {
        ...sourceIndex,
        entries: [...sourceIndex.entries]
          .reverse()
          .map((entry) => ({ ...entry, sources: [...entry.sources].reverse() })),
      },
      query,
      { roles: [...SOURCE_ROLES].reverse(), resolutions: [...SOURCE_RESOLUTIONS].reverse() },
    ).matches.map(key);
    expect(reversed).toEqual(all);
    expect(all).toEqual([...all].sort());
    const facadeAll = await analysis.sources({
      query,
      roles: [...SOURCE_ROLES].reverse(),
      resolutions: [...SOURCE_RESOLUTIONS].reverse(),
    });
    expect(facadeAll.items.map(facadeKey)).toEqual(all);

    for (const role of SOURCE_ROLES) {
      const direct = queryApplicationSources(sourceIndex, query, { roles: [role] }).matches;
      const facade = await analysis.sources({ query, roles: [role] });
      expect(new Set(direct.map(({ anchor }) => anchor.resolution))).toEqual(
        new Set(SOURCE_RESOLUTIONS),
      );
      expect(facade.items.map(facadeKey)).toEqual(direct.map(key));
    }
    for (const resolution of SOURCE_RESOLUTIONS) {
      const direct = queryApplicationSources(sourceIndex, query, {
        resolutions: [resolution],
      }).matches;
      const facade = await analysis.sources({ query, resolutions: [resolution] });
      expect(new Set(direct.map(({ anchor }) => anchor.role))).toEqual(new Set(SOURCE_ROLES));
      expect(facade.items.map(facadeKey)).toEqual(direct.map(key));
    }
    for (const [position, role] of SOURCE_ROLES.entries()) {
      const resolution = SOURCE_RESOLUTIONS[(position + 1) % SOURCE_RESOLUTIONS.length];
      const options = { roles: [role], resolutions: [resolution] } as const;
      const direct = queryApplicationSources(sourceIndex, query, options).matches;
      const facade = await analysis.sources({ query, ...options });
      expect(direct.map(key)).toEqual([`${role}\0${resolution}`]);
      expect(facade.items.map(facadeKey)).toEqual(direct.map(key));
    }
  });

  test("applies impact filters before traversal and navigates within hard bounds", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const concept: DesignRef = { kind: "concept", concept: "Todos" };
    const memberOnly = await analysis.impact({
      seeds: [concept],
      relations: ["concept-member"],
      maxDepth: 2,
    });
    expect(memberOnly.trace.affected.map(({ ref }) => ref)).toContainEqual(add);
    expect(memberOnly.trace.affected.some(({ ref }) => ref.kind === "reaction")).toBe(false);
    const context = await analysis.impact({ seeds: [add], detail: "context" });
    expect(context.context?.selection.some(({ roles }) => roles.includes("seed"))).toBe(true);
    await expect(analysis.impact({ seeds: [] })).rejects.toSatisfy(expectCode("INVALID_ARGUMENT"));
    await expect(
      analysis.impact({ seeds: [{ kind: "reaction", reaction: "missing" }] }),
    ).rejects.toSatisfy(expectCode("NOT_FOUND"));

    const navigation = await analysis.navigate({
      ref: add,
      direction: "outgoing",
      maxDepth: 2,
    });
    expect(navigation.nodes[0].distance).toBeGreaterThanOrEqual(0);
    expect(navigation.nodes.some(({ ref }) => ref.kind === "reaction")).toBe(true);
    const limited = await analysis.navigate({ ref: add, maxNodes: 1 });
    expect(limited.complete).toBe(false);
    expect(limited.diagnostics[0].code).toBe("NAVIGATION_LIMIT_REACHED");
  });

  test("builds evidence-only change targets from refs and source ranges", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const target = await analysis.target({ refs: [add], seeds: [add] });
    expect(target.seeds).toEqual([add]);
    expect(target.files.some(({ roles }) => roles.includes("seed"))).toBe(true);
    expect(target).not.toHaveProperty("allowlist");
    expect(target).not.toHaveProperty("approved");
    const sourceMatch = (await analysis.sources({ query: { kind: "ref", ref: add } })).items[0];
    const bySource = await analysis.target({
      source: {
        kind: "cursor",
        path: sourceMatch.metadata.path,
        offset: sourceMatch.metadata.range.start.offset,
      },
    });
    expect(bySource.seeds.length).toBeGreaterThan(0);
    const logical = createApplicationAnalysis({ manifest });
    expect((await logical.target({ refs: [add] })).sourceAvailability).toBe("unavailable");
    await expect(
      logical.target({ source: { kind: "cursor", path: "app.ts", offset: 0 } }),
    ).rejects.toSatisfy(expectCode("CAPABILITY_UNAVAILABLE"));
  });

  test("unifies and filters diagnostics and deterministic guidance", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const diagnostics = await analysis.diagnostics();
    expect(new Set(diagnostics.items.map(({ origin }) => origin))).toEqual(
      new Set(["manifest", "typescript", "index", "source"]),
    );
    expect(new Set(diagnostics.items.map(({ id }) => id)).size).toBe(diagnostics.total);
    expect(
      (
        await analysis.diagnostics({
          filters: {
            origins: ["source"],
            severities: ["error"],
            refs: [{ kind: "concept", concept: "Todos" }],
          },
        })
      ).items.map(({ code }) => code),
    ).toEqual(["SPECIFICATION_MISMATCH"]);
    const guidance = await analysis.guidance();
    expect(guidance.canonicalGuidance).toBeNull();
    expect(guidance.items.map(({ ruleId }) => ruleId)).toEqual(
      expect.arrayContaining([
        "possible-impact-caveat",
        "opaque-definition",
        "ambiguous-unresolved-source",
        "source-spec-mismatch",
        "generated-contract-vs-validation",
        "declaration-order-not-priority",
        "exact-revision-provenance",
      ]),
    );
    expect(
      guidance.items
        .map(({ message }) => message)
        .join(" ")
        .toLowerCase(),
    ).not.toContain("approved");

    const selection = selectGuidance(await loadGuidanceResource(), {
      ids: ["design-reactions", "review-scenarios"],
    });
    const linked = await analysis.guidance({ selection });
    expect(linked.canonicalGuidance).toEqual({
      selectionDigest: selection.digest,
      resourceDigest: selection.resourceDigest,
      producer: selection.producer,
      source: selection.source,
      entries: selection.entries.map(({ id, path, anchor, digest }) => ({
        id,
        path,
        anchor,
        digest,
      })),
      complete: true,
    });
    expect(linked.items.map(({ ruleId }) => ruleId)).toEqual(
      expect.arrayContaining(["possible-impact-caveat", "source-spec-mismatch"]),
    );
    const linkedRoundTrip = parseApplicationAnalysisResult(renderApplicationAnalysisResult(linked));
    expect(linkedRoundTrip).toEqual(linked);
    const malformedLinks: readonly [string, (value: typeof linked) => void][] = [
      [
        "selection digest",
        (value) =>
          ((value.canonicalGuidance as { selectionDigest: string }).selectionDigest = "bad"),
      ],
      [
        "repository",
        (value) =>
          ((value.canonicalGuidance!.source as { repository: string }).repository =
            "https://example.invalid/repository"),
      ],
      [
        "documents digest",
        (value) =>
          ((value.canonicalGuidance!.source as { documentsDigest: string }).documentsDigest =
            "bad"),
      ],
      [
        "unbound revision",
        (value) =>
          ((value.canonicalGuidance!.source as { revision: string }).revision =
            "development:stale"),
      ],
      [
        "entry digest",
        (value) => ((value.canonicalGuidance!.entries[0] as { digest: string }).digest = "bad"),
      ],
      [
        "entry order",
        (value) => (value.canonicalGuidance!.entries as unknown as unknown[]).reverse(),
      ],
      [
        "link completeness",
        (value) => ((value.canonicalGuidance as { complete: unknown }).complete = "yes"),
      ],
    ];
    for (const [label, mutate] of malformedLinks) {
      const malformed = structuredClone(linked);
      mutate(malformed);
      let caught: unknown;
      try {
        validateApplicationAnalysisResult(malformed);
      } catch (error) {
        caught = error;
      }
      expect(caught, label).toMatchObject({ code: "INVALID_FORMAT" });
    }
    const tamperedLink = structuredClone(linked);
    (tamperedLink.canonicalGuidance!.producer as { coreVersion: string }).coreVersion =
      "1.0.0-beta.6";
    expectThrowsCode(() => validateApplicationAnalysisResult(tamperedLink), "SNAPSHOT_MISMATCH");

    const olderManifest = fixture();
    olderManifest.generator.version = "1.0.0-beta.6";
    redigest(olderManifest);
    const older = createApplicationAnalysis({ manifest: olderManifest });
    await expect(older.guidance({ selection })).rejects.toSatisfy(expectCode("SNAPSHOT_MISMATCH"));
  });

  test("pages logical and rendered contracts and exact provenance without executing projections", async () => {
    const manifest = fixture();
    const analysis = createApplicationAnalysis({ manifest, project: project(manifest) });
    const contracts = await analysis.contracts({
      detail: "rendered",
      filters: { endpoints: ["AddEndpoint"], paths: ["/todos/add"] },
      projections: [
        {
          name: "caller",
          provenance: { name: "fixture", version: "1" },
          wire: manifest.wire,
        },
      ],
    });
    expect(contracts.projectionEvidence).toBe("caller-supplied");
    expect(contracts.rendered?.inputContracts).toContain("/todos/add");
    expect(contracts.rendered?.logicalWire).toContain("/todos/add");
    expect(contracts.rendered?.projections[0].name).toBe("caller");
    const provenance = await analysis.provenance({ page: { limit: 1 } });
    expect(provenance.facts).toMatchObject({
      analyzer: { name: "@mit-sdg/sync-engine-analysis" },
      manifest: { digest: manifest.digest },
      project: { sourceRevision: "revision-before", typescriptVersion: ts.version },
    });
    expect(provenance.items).toHaveLength(1);
  });

  test("reviews exact before/after evidence without a verdict or silent truncation", async () => {
    const beforeManifest = fixture();
    const afterManifest = fixture(true);
    const before = createApplicationAnalysis({
      manifest: beforeManifest,
      project: project(beforeManifest),
    });
    const after = createApplicationAnalysis({
      manifest: afterManifest,
      project: project(afterManifest, true),
    });
    const review = await after.reviewChange(before, {
      changedPaths: ["app.ts"],
      detail: "definitions",
      maxDepth: 2,
      target: { refs: [add] },
    });
    expect(review.designChanges).toContainEqual(
      expect.objectContaining({
        ref: add,
        change: "modified",
        aspects: expect.arrayContaining(["contract", "source"]),
      }),
    );
    expect(review.fileChanges).toEqual([
      expect.objectContaining({ path: "app.ts", change: "modified", declaredChanged: true }),
    ]);
    expect(review.contractChanges.length).toBeGreaterThan(0);
    expect(review.introducedDiagnostics).toContainEqual(expect.objectContaining({ code: "9002" }));
    expect(review.resolvedDiagnostics).toContainEqual(expect.objectContaining({ code: "9001" }));
    expect(review.targetDrift).toBeDefined();
    expect(review.coverage).toMatchObject({
      definitions: "complete",
      contracts: "complete",
      sources: "before-and-after",
      target: "evaluated",
    });
    expect(review).not.toHaveProperty("verdict");
    await expect(after.reviewChange(before, { maxChanges: 0 })).rejects.toSatisfy(
      expectCode("LIMIT_EXCEEDED"),
    );
  });

  test("reports no-op, before-only, and after-only review source coverage", async () => {
    const manifest = fixture();
    const logicalBefore = createApplicationAnalysis({ manifest });
    const logicalAfter = createApplicationAnalysis({ manifest });
    const noOp = await logicalAfter.reviewChange(logicalBefore, { changedPaths: [] });
    expect(noOp.designChanges).toEqual([]);
    expect(noOp.fileChanges).toEqual([]);
    expect(noOp.coverage.sources).toBe("unavailable");
    expect(noOp.observations).toContain("No design inventory definition changed.");

    const backed = createApplicationAnalysis({ manifest, project: project(manifest) });
    const afterOnly = await backed.reviewChange(logicalBefore);
    expect(afterOnly.coverage.sources).toBe("after-only");
    expect(afterOnly.fileChanges.some(({ change }) => change === "added")).toBe(true);

    const beforeOnly = await logicalAfter.reviewChange(backed);
    expect(beforeOnly.coverage.sources).toBe("before-only");
    expect(beforeOnly.fileChanges.some(({ change }) => change === "removed")).toBe(true);

    const sameBacked = createApplicationAnalysis({ manifest, project: project(manifest) });
    const declaredOnly = await sameBacked.reviewChange(backed, {
      changedPaths: ["unobserved.ts"],
    });
    expect(declaredOnly.coverage.sources).toBe("before-and-after");
    expect(declaredOnly.observations).toEqual(
      expect.arrayContaining([
        "No project file digest changed.",
        "Caller-supplied changed path unobserved.ts has no observed file digest change.",
      ]),
    );
  });

  test("round-trips, validates, digests, and rejects tampered persisted results", async () => {
    const analysis = createApplicationAnalysis({ manifest: fixture() });
    const result = await analysis.catalog({ page: { limit: 2 } });
    const rendered = renderApplicationAnalysisResult(result);
    const parsed = parseApplicationAnalysisResult(rendered);
    expect(parsed).toEqual(result);
    expect(applicationAnalysisResultDigest(parsed)).toBe(applicationAnalysisResultDigest(result));
    expect(() => validateApplicationAnalysisResult(parsed)).not.toThrow();

    const extra = { ...parsed, unexpected: true };
    expectThrowsCode(() => validateApplicationAnalysisResult(extra), "INVALID_FORMAT");
    const mismatched = structuredClone(parsed);
    (mismatched.identity as { manifestDigest: string }).manifestDigest = "tampered";
    expectThrowsCode(() => validateApplicationAnalysisResult(mismatched), "SNAPSHOT_MISMATCH");
    const nonFinite = structuredClone(parsed);
    (nonFinite.resourceUsage as { graphNodes: number }).graphNodes = Number.NaN;
    expectThrowsCode(() => validateApplicationAnalysisResult(nonFinite), "INVALID_FORMAT");
  });

  test("strictly rejects malformed result scalars, provenance, pages, and content modes", async () => {
    const manifest = fixture();
    const logical = createApplicationAnalysis({ manifest });
    const catalog = await logical.catalog({ page: { limit: 2 } });
    expectThrowsCode(() => parseApplicationAnalysisResult(null as never), "INVALID_ARGUMENT");
    expectThrowsCode(() => parseApplicationAnalysisResult("{"), "INVALID_FORMAT");

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const [label, value] of [
      ["null", null],
      ["array", []],
      ["function", () => undefined],
      ["cycle", cycle],
      ["non-plain", new Date(0)],
    ] as const) {
      expect(() => validateApplicationAnalysisResult(value), label).toThrow(
        expect.objectContaining({ code: "INVALID_FORMAT" }),
      );
    }

    const mutations: readonly [string, string, (value: Record<string, unknown>) => void][] = [
      ["format", "INVALID_FORMAT", (value) => (value.format = "stale")],
      ["version", "UNSUPPORTED_VERSION", (value) => (value.version = 2)],
      ["kind", "INVALID_FORMAT", (value) => (value.kind = "unknown")],
      [
        "identity source pair",
        "INVALID_FORMAT",
        (value) => ((value.identity as Record<string, unknown>).sourceRevision = "revision"),
      ],
      [
        "empty identity field",
        "INVALID_FORMAT",
        (value) => ((value.identity as Record<string, unknown>).analyzerVersion = ""),
      ],
      [
        "analyzer name",
        "INVALID_FORMAT",
        (value) =>
          ((
            (value.provenance as Record<string, unknown>).analyzer as Record<string, unknown>
          ).name = "other"),
      ],
      [
        "analyzer identity",
        "SNAPSHOT_MISMATCH",
        (value) =>
          ((
            (value.provenance as Record<string, unknown>).analyzer as Record<string, unknown>
          ).version = "other"),
      ],
      [
        "manifest format",
        "INVALID_FORMAT",
        (value) =>
          ((
            (value.provenance as Record<string, unknown>).manifest as Record<string, unknown>
          ).format = "other"),
      ],
      [
        "manifest version",
        "UNSUPPORTED_VERSION",
        (value) =>
          ((
            (value.provenance as Record<string, unknown>).manifest as Record<string, unknown>
          ).version = 4),
      ],
      [
        "manifest digest",
        "SNAPSHOT_MISMATCH",
        (value) =>
          ((
            (value.provenance as Record<string, unknown>).manifest as Record<string, unknown>
          ).digest = "other"),
      ],
      [
        "manifest generator",
        "INVALID_FORMAT",
        (value) => {
          const manifestValue = (value.provenance as Record<string, unknown>).manifest as Record<
            string,
            unknown
          >;
          (manifestValue.generator as Record<string, unknown>).name = "";
        },
      ],
      [
        "core identity",
        "SNAPSHOT_MISMATCH",
        (value) => {
          const manifestValue = (value.provenance as Record<string, unknown>).manifest as Record<
            string,
            unknown
          >;
          (manifestValue.generator as Record<string, unknown>).version = "other";
        },
      ],
      ["complete", "INVALID_FORMAT", (value) => (value.complete = "yes")],
      ["resource shape", "INVALID_FORMAT", (value) => (value.resourceUsage = [])],
      [
        "negative resource",
        "INVALID_FORMAT",
        (value) => ((value.resourceUsage as Record<string, unknown>).graphNodes = -1),
      ],
      ["items shape", "INVALID_FORMAT", (value) => (value.items = {})],
      ["fractional total", "INVALID_FORMAT", (value) => (value.total = 0.5)],
      ["next offset past total", "INVALID_FORMAT", (value) => (value.nextOffset = 99)],
      [
        "summary availability",
        "INVALID_FORMAT",
        (value) =>
          ((value.items as Array<Record<string, unknown>>)[0].sourceAvailability = "other"),
      ],
      [
        "summary paths",
        "INVALID_FORMAT",
        (value) => ((value.items as Array<Record<string, unknown>>)[0].sourcePaths = {}),
      ],
      [
        "summary counts",
        "INVALID_FORMAT",
        (value) => {
          const item = (value.items as Array<Record<string, unknown>>)[0];
          (item.diagnostics as Record<string, unknown>).error = -1;
        },
      ],
    ];
    for (const [label, code, mutate] of mutations) {
      const malformed = structuredClone(catalog) as unknown as Record<string, unknown>;
      mutate(malformed);
      let caught: unknown;
      try {
        validateApplicationAnalysisResult(malformed);
      } catch (error) {
        caught = error;
      }
      expect(caught, label).toMatchObject({ code });
    }

    const search = await logical.search({ query: "Todos", fields: ["identity"] });
    const emptyFields = structuredClone(search);
    (emptyFields.fields as string[]).splice(0);
    expectThrowsCode(() => validateApplicationAnalysisResult(emptyFields), "INVALID_FORMAT");
    const wrongMatchedField = structuredClone(search);
    (wrongMatchedField.items[0] as { matchedField: string }).matchedField = "contract";
    expectThrowsCode(() => validateApplicationAnalysisResult(wrongMatchedField), "INVALID_FORMAT");

    const backed = createApplicationAnalysis({ manifest, project: project(manifest) });
    const withText = await backed.sources({ query: { kind: "ref", ref: add }, content: "text" });
    const withoutRequestedText = structuredClone(withText);
    delete (withoutRequestedText.items[0] as { text?: string }).text;
    expectThrowsCode(
      () => validateApplicationAnalysisResult(withoutRequestedText),
      "INVALID_FORMAT",
    );
    const metadataOnly = await backed.sources({ query: { kind: "ref", ref: add } });
    const withUnrequestedText = structuredClone(metadataOnly);
    (withUnrequestedText.items[0] as { text?: string }).text = "unexpected";
    expectThrowsCode(
      () => validateApplicationAnalysisResult(withUnrequestedText),
      "INVALID_FORMAT",
    );
    const withExcerpt = structuredClone(withText);
    const source = withExcerpt.items[0];
    (source.metadata as { excerpt?: unknown }).excerpt = {
      range: structuredClone(source.metadata.range),
      text: source.text,
      complete: true,
    };
    expect(() => validateApplicationAnalysisResult(withExcerpt)).not.toThrow();
    ((source.metadata as { excerpt: { complete: unknown } }).excerpt.complete as unknown) = "yes";
    expectThrowsCode(() => validateApplicationAnalysisResult(withExcerpt), "INVALID_FORMAT");

    const impact = await logical.impact({ seeds: [add] });
    const inconsistentImpact = structuredClone(impact);
    (inconsistentImpact.trace as { complete: boolean }).complete = !inconsistentImpact.complete;
    expectThrowsCode(
      () => validateApplicationAnalysisResult(inconsistentImpact),
      "SNAPSHOT_MISMATCH",
    );

    const contracts = await logical.contracts({
      projections: [
        { name: "fixture", provenance: { name: "fixture", version: "1" }, wire: manifest.wire },
      ],
    });
    const inconsistentContracts = structuredClone(contracts);
    (inconsistentContracts as { projectionEvidence: string }).projectionEvidence = "none";
    expectThrowsCode(
      () => validateApplicationAnalysisResult(inconsistentContracts),
      "INVALID_FORMAT",
    );
  });

  test("converts cancellation and canonical result byte limits at the facade boundary", async () => {
    const analysis = createApplicationAnalysis({ manifest: fixture() });
    const abort = new AbortController();
    abort.abort("stop");
    await expect(analysis.catalog({ signal: abort.signal })).rejects.toSatisfy(
      expectCode("ABORTED"),
    );
    await expect(analysis.catalog({ maxResultBytes: 1 })).rejects.toSatisfy(
      expectCode("LIMIT_EXCEEDED"),
    );
    await expect(analysis.catalog({ maxResultBytes: 65 * 1024 * 1024 })).rejects.toSatisfy(
      expectCode("LIMIT_EXCEEDED"),
    );
  });
});
