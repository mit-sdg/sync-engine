import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applicationManifestDigest,
  parseConceptSpecification,
  type ApplicationManifestV4,
} from "@mit-sdg/sync-engine/tooling";
import {
  contextForImpact,
  designRefsForSourceRange,
  indexApplication,
  indexApplicationSources,
  loadApplicationProject,
  traceApplicationImpact,
  type DesignRef,
} from "@mit-sdg/sync-engine-analysis/tooling";
import { afterEach, describe, expect, test } from "vite-plus/test";
import ts from "typescript";

function fixture(): ApplicationManifestV4 {
  return {
    format: "sync-engine.application-manifest",
    version: 4,
    generator: { name: "@mit-sdg/sync-engine", version: "1.0.0-beta.5" },
    digest: "fixture-manifest",
    concepts: [
      {
        name: "Alerting",
        actions: [{ name: "raise", roles: ["subject"] }],
        queries: [],
      },
      {
        name: "Discussing",
        actions: [{ name: "open", roles: ["subject"] }],
        queries: [],
      },
      {
        name: "Selecting",
        actions: [{ name: "choose", roles: ["item"] }],
        queries: [{ name: "_current", roles: [], returns: "optional" }],
      },
      {
        name: "Unrelated",
        actions: [{ name: "touch" }],
        queries: [],
      },
    ],
    application: {
      reactions: [
        {
          name: "Select",
          when: [
            {
              kind: "action",
              concept: "Selecting",
              action: "choose",
              posture: "returned",
              input: { item: { $var: "item" } },
              output: {},
            },
          ],
          where: [
            {
              op: "find",
              view: "current selection",
              in: {},
              out: { selected: { $var: "item" } },
            },
          ],
          then: [
            {
              kind: "request",
              concept: "Discussing",
              action: "open",
              input: { subject: { $var: "item" } },
            },
          ],
        },
        {
          name: "Select#2",
          when: [
            {
              kind: "action",
              concept: "Discussing",
              action: "open",
              posture: "returned",
              by: "Select",
              input: { subject: { $var: "subject" } },
              output: {},
            },
          ],
          where: [],
          then: [
            {
              kind: "request",
              concept: "Alerting",
              action: "raise",
              input: { subject: { $var: "subject" } },
            },
          ],
        },
        {
          name: "ObserveCurrent",
          when: [
            {
              kind: "action",
              concept: "Alerting",
              action: "raise",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [
            {
              op: "find",
              query: { concept: "Selecting", query: "_current" },
              in: {},
              out: {},
            },
          ],
          then: [],
        },
      ],
      views: [
        {
          name: "current selection",
          ins: [],
          outs: ["selected"],
          bindings: [],
          promise: "optional",
          alternatives: [
            [
              {
                op: "find",
                query: { concept: "Selecting", query: "_current" },
                in: {},
                out: { selected: { $var: "selected" } },
              },
            ],
          ],
        },
      ],
      formers: [
        {
          name: "selection summary",
          ins: [],
          bindings: ["selected"],
          promise: "optional",
          body: {
            node: "record",
            where: [
              {
                op: "find",
                view: "current selection",
                in: {},
                out: { selected: { $var: "selected" } },
              },
            ],
            entries: { selected: { node: "leaf", var: "selected" } },
          },
        },
      ],
      unlowered: [
        {
          name: "LocalRepair",
          reason: "uses a local closure",
          known: {
            when: [
              {
                kind: "action",
                concept: "Alerting",
                action: "raise",
                posture: "returned",
                input: {},
                output: {},
              },
            ],
            where: [],
            then: [
              {
                kind: "request",
                concept: "Selecting",
                action: "choose",
                input: { item: "repair" },
              },
            ],
            patterns: [],
          },
        },
      ],
    },
    endpoints: [
      {
        name: "Select",
        path: "/selections/choose",
        reactions: ["Select"],
        input: { required: ["item"] },
        validators: { input: false, output: false },
      },
    ],
    inputContracts: { "/selections/choose": { required: ["item"] } },
    wire: { endpoints: [], appWide: [] },
    diagnostics: [],
  };
}

const choose: DesignRef = { kind: "action", concept: "Selecting", action: "choose" };

const selectingSpec = `# Selecting

## Purpose

Keep one current selection.

## Principle

Choosing an item makes it current.

## Actions

\`\`\`actions
choose (item: Item) : return (item: Item)
\`\`\`

## Queries

\`\`\`queries
_current () : optional (item: Item)
\`\`\`
`;

function programFor(files: Readonly<Record<string, string>>): ts.Program {
  const normalized = new Map(
    Object.entries(files).map(([path, source]) => [
      path.startsWith("/") ? path : `/project/${path}`,
      source,
    ]),
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noResolve: true,
  };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (path) => normalized.has(path) || base.fileExists(path),
    readFile: (path) => normalized.get(path) ?? base.readFile(path),
    getSourceFile: (path, languageVersion) => {
      const source = normalized.get(path);
      return source === undefined
        ? base.getSourceFile(path, languageVersion)
        : ts.createSourceFile(path, source, languageVersion, false, ts.ScriptKind.TS);
    },
    getCurrentDirectory: () => "/project",
    writeFile: () => undefined,
  };
  return ts.createProgram({ rootNames: [...normalized.keys()], options, host });
}

const temporaryProjects: string[] = [];

afterEach(() => {
  for (const path of temporaryProjects.splice(0)) rmSync(path, { recursive: true, force: true });
});

function applicationProject(): string {
  const root = mkdtempSync(join(tmpdir(), "sync-engine-analysis-"));
  temporaryProjects.push(root);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "stubs"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          allowImportingTsExtensions: true,
          baseUrl: ".",
          paths: {
            "@mit-sdg/sync-engine/assembly": ["stubs/core.d.ts"],
            "@mit-sdg/sync-engine/boundary": ["stubs/core.d.ts"],
            "@mit-sdg/sync-engine/language": ["stubs/core.d.ts"],
          },
        },
        files: ["src/index.ts", "stubs/core.d.ts", "stubs/text.d.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, "stubs/core.d.ts"),
    `declare module "@mit-sdg/sync-engine/assembly" {
  export function registerConcept<T>(registration: T): T;
}
declare module "@mit-sdg/sync-engine/boundary" {
  export function endpoint<T>(path: string, declaration: () => T): T;
}
declare module "@mit-sdg/sync-engine/language" {
  export function reaction<T>(declaration: () => T): T;
  export function view<T>(name: string, declaration: () => T): T;
  export function former<T>(name: string, declaration: () => T): T;
}
`,
  );
  writeFileSync(
    join(root, "stubs/text.d.ts"),
    `declare module "*.md" { const text: string; export default text; }\n`,
  );
  writeFileSync(join(root, "src/selecting.md"), selectingSpec);
  writeFileSync(
    join(root, "src/concept.ts"),
    `import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "./selecting.md" with { type: "text" };

export class SelectingConcept {
  choose({ item }: { item: string }) { return { item }; }
  _current() { return []; }
}
export class DiscussingConcept { open({ subject }: { subject: string }) { return { subject }; } }
export class AlertingConcept { raise({ subject }: { subject: string }) { return { subject }; } }
export class UnrelatedConcept { touch() { return {}; } }
export const selecting = registerConcept({ class: SelectingConcept, spec });
export const Selecting = new SelectingConcept();
export const Discussing = new DiscussingConcept();
export const Alerting = new AlertingConcept();
`,
  );
  writeFileSync(
    join(root, "src/reactions.ts"),
    `import { former, reaction as react, view } from "@mit-sdg/sync-engine/language";
import { Alerting, Discussing, Selecting } from "./concept.ts";

export const Select = react(() => Selecting.choose({ item: "x" }) && Discussing.open({ subject: "x" }));
export const ObserveCurrent = react(() => Selecting._current() && Alerting.raise({ subject: "x" }));
export const LocalRepair = react(() => Alerting.raise({ subject: "x" }) && Selecting.choose({ item: "repair" }));
export const currentSelection = view("current selection", () => Selecting._current());
export const selectionSummary = former("selection summary", () => Selecting._current());
`,
  );
  writeFileSync(
    join(root, "src/endpoint.ts"),
    `import { endpoint } from "@mit-sdg/sync-engine/boundary";
import { Selecting } from "./concept.ts";
export const ChooseEndpoint = endpoint("/selections/choose", () => Selecting.choose({ item: "x" }));
`,
  );
  writeFileSync(join(root, "src/diagnostic.ts"), "export const broken: string = 42;\n");
  writeFileSync(
    join(root, "src/index.ts"),
    `export * from "./concept.ts";
export * from "./reactions.ts";
export * from "./endpoint.ts";
import "./diagnostic.ts";
`,
  );
  return root;
}

function projectManifest(): ApplicationManifestV4 {
  const manifest = fixture();
  manifest.application.reactions.push({
    name: "ChooseEndpoint",
    when: [],
    where: [],
    then: [],
  });
  manifest.endpoints = [
    {
      name: "ChooseEndpoint",
      path: "/selections/choose",
      reactions: ["ChooseEndpoint"],
      input: { required: ["item"] },
      validators: { input: false, output: false },
    },
  ];
  manifest.concepts.find(({ name }) => name === "Selecting")!.specification =
    parseConceptSpecification(selectingSpec);
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

const applicationSource = `import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { endpoint } from "@mit-sdg/sync-engine/boundary";
import { former, reaction as react, view } from "@mit-sdg/sync-engine/language";
import spec from "./spec.md" with { type: "text" };

export class SelectingConcept {
  choose({ item }: { item: string }) { return { item }; }
  _current() { return []; }
}
export class DiscussingConcept { open({ subject }: { subject: string }) { return { subject }; } }
export class AlertingConcept { raise({ subject }: { subject: string }) { return { subject }; } }
export class UnrelatedConcept { touch() { return {}; } }

export const selecting = registerConcept({ class: SelectingConcept, spec });
const Selecting = new SelectingConcept();
const Discussing = new DiscussingConcept();
const Alerting = new AlertingConcept();

export const Select = react(() => Selecting.choose({ item: "x" }) && Discussing.open({ subject: "x" }));
export const ObserveCurrent = react(() => Selecting._current() && Alerting.raise({ subject: "x" }));
export const LocalRepair = react(() => Alerting.raise({ subject: "x" }) && Selecting.choose({ item: "repair" }));
export const currentSelection = view("current selection", () => Selecting._current());
export const selectionSummary = former("selection summary", () => Selecting._current());
export const ChooseEndpoint = endpoint("/selections/choose", () => Selecting.choose({ item: "x" }));
`;

describe("application impact analysis", () => {
  test("indexes structural, conservative, causal, endpoint, and opaque dependencies", () => {
    const index = indexApplication(fixture());

    expect(index.edges).toContainEqual({
      from: choose,
      to: { kind: "reaction", reaction: "Select" },
      relation: "action-trigger",
      certainty: "structural",
    });
    expect(index.edges).toContainEqual({
      from: choose,
      to: { kind: "query", concept: "Selecting", query: "_current" },
      relation: "same-concept-state",
      certainty: "conservative",
    });
    expect(index.edges).toContainEqual({
      from: { kind: "reaction", reaction: "Select" },
      to: { kind: "action", concept: "Discussing", action: "open" },
      relation: "reaction-asks",
      certainty: "structural",
    });
    expect(index.edges).toContainEqual({
      from: { kind: "reaction", reaction: "Select#2" },
      to: { kind: "endpoint", endpoint: "Select", path: "/selections/choose" },
      relation: "stage-affects-endpoint",
      certainty: "structural",
    });
    expect(index.issues).toContainEqual(
      expect.objectContaining({
        code: "OPAQUE_DEFINITION",
        ref: { kind: "reaction", reaction: "LocalRepair" },
      }),
    );
  });

  test("is stable when non-semantic manifest collections arrive in another order", () => {
    const first = fixture();
    const second = fixture();
    second.concepts.reverse();
    second.application.reactions.reverse();
    second.application.views.reverse();
    second.application.formers.reverse();
    second.application.unlowered.reverse();
    second.endpoints.reverse();

    expect(indexApplication(second)).toEqual(indexApplication(first));
  });

  test("traces one deterministic causal and standing-state impact closure", () => {
    const index = indexApplication(fixture());
    const trace = traceApplicationImpact(index, [choose]);
    const reactionNames = trace.affected.flatMap(({ ref }) =>
      ref.kind === "reaction" ? [ref.reaction] : [],
    );

    expect(reactionNames).toEqual(
      expect.arrayContaining(["LocalRepair", "ObserveCurrent", "Select", "Select#2"]),
    );
    expect(
      trace.affected.find(({ ref }) => ref.kind === "reaction" && ref.reaction === "Select#2")
        ?.path,
    ).toEqual([
      expect.objectContaining({ relation: "action-trigger" }),
      expect.objectContaining({ relation: "provenance-trigger" }),
    ]);
  });

  test("preloads only traced facts and their direct supporting contracts", () => {
    const manifest = fixture();
    const index = indexApplication(manifest);
    const trace = traceApplicationImpact(index, [choose]);
    const context = contextForImpact(manifest, index, trace);

    expect(context.concepts.map(({ name }) => name)).toEqual([
      "Alerting",
      "Discussing",
      "Selecting",
    ]);
    expect(context.concepts.map(({ name }) => name)).not.toContain("Unrelated");
    expect(context.reactions.map(({ name }) => name)).toEqual([
      "LocalRepair",
      "ObserveCurrent",
      "Select",
      "Select#2",
    ]);
    expect(context.reactions.find(({ name }) => name === "Select")?.rendered).toContain(
      "Discussing.open (subject: item)",
    );
    expect(context.selection).toContainEqual({
      ref: choose,
      roles: ["seed", "affected", "support"],
    });
  });

  test("reports unknown seeds and explicit trace limits", () => {
    const index = indexApplication(fixture());
    const unknown = traceApplicationImpact(index, [{ kind: "reaction", reaction: "Missing" }]);
    expect(unknown.issues).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SEED" }));

    const limited = traceApplicationImpact(index, [choose], { maxDepth: 0, maxNodes: 1 });
    expect(limited.affected).toHaveLength(1);
    expect(limited.issues).toContainEqual(expect.objectContaining({ code: "TRACE_LIMIT_REACHED" }));

    const seedLimited = traceApplicationImpact(
      index,
      [choose, { kind: "concept", concept: "Selecting" }],
      { maxNodes: 1 },
    );
    expect(seedLimited.affected).toHaveLength(1);
    expect(seedLimited.issues).toContainEqual(
      expect.objectContaining({ code: "TRACE_LIMIT_REACHED" }),
    );
  });

  test("maps logical context to bounded, hashed TypeScript and specification slices", () => {
    const manifest = fixture();
    manifest.application.reactions.push({
      name: "ChooseEndpoint",
      when: [],
      where: [],
      then: [],
    });
    manifest.endpoints = [
      {
        name: "ChooseEndpoint",
        path: "/selections/choose",
        reactions: ["ChooseEndpoint"],
        input: { required: ["item"] },
        validators: { input: false, output: false },
      },
    ];
    const program = programFor({ "app.ts": applicationSource });
    const sourceIndex = indexApplicationSources({
      manifest,
      program,
      projectRoot: "/project",
      readFile: (path) => (path === "/project/spec.md" ? selectingSpec : undefined),
    });

    const action = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "action" && ref.concept === "Selecting" && ref.action === "choose",
    );
    expect(action?.sources.map(({ role }) => role)).toEqual(["implementation", "specification"]);
    expect(action?.sources.every(({ range }) => !range.path.startsWith("/"))).toBe(true);
    expect(action?.sources.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);

    const select = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Select",
    );
    expect(select?.sources[0]?.text).toContain("export const Select = react");
    const endpoint = sourceIndex.entries.find(({ ref }) => ref.kind === "endpoint");
    expect(endpoint?.sources[0]?.text).toContain("export const ChooseEndpoint = endpoint");

    const index = indexApplication(manifest);
    const trace = traceApplicationImpact(index, [choose]);
    const context = contextForImpact(manifest, index, trace, sourceIndex);
    expect(context.sources.some(({ ref }) => ref.kind === "action")).toBe(true);
    expect(context.sourceIssues).not.toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_DESIGN_SOURCE" }),
    );
  });

  test("reports ambiguous declarations rather than selecting by source order", () => {
    const manifest = fixture();
    manifest.endpoints = [];
    const duplicate = applicationSource.replace(
      "export const Select = react",
      "export const Select = react",
    );
    const sourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "a.ts": applicationSource, "b.ts": duplicate }),
      projectRoot: "/project",
      readFile: (path) => (path === "/project/spec.md" ? selectingSpec : undefined),
    });

    expect(sourceIndex.issues).toContainEqual(
      expect.objectContaining({
        code: "AMBIGUOUS_DESIGN_SOURCE",
        ref: { kind: "reaction", reaction: "Select" },
      }),
    );
    expect(
      sourceIndex.entries.some(({ ref }) => ref.kind === "reaction" && ref.reaction === "Select"),
    ).toBe(false);
  });

  test("compares specifications independent of object key insertion order", () => {
    const manifest = fixture();
    const parsed = parseConceptSpecification(selectingSpec);
    const reordered = {
      documentation: parsed.documentation,
      queries: parsed.queries,
      actions: parsed.actions,
      principle: parsed.principle,
      purpose: parsed.purpose,
      version: parsed.version,
      format: parsed.format,
    } as typeof parsed;
    manifest.concepts.find(({ name }) => name === "Selecting")!.specification = reordered;
    const sourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "app.ts": applicationSource }),
      projectRoot: "/project",
      readFile: (path) => (path === "/project/spec.md" ? selectingSpec : undefined),
    });

    expect(sourceIndex.issues).not.toContainEqual(
      expect.objectContaining({ code: "SPECIFICATION_MISMATCH" }),
    );
  });

  test("diagnoses a registered specification that cannot be read", () => {
    const sourceIndex = indexApplicationSources({
      manifest: fixture(),
      program: programFor({ "app.ts": applicationSource }),
      projectRoot: "/project",
      readFile: () => undefined,
    });

    expect(sourceIndex.issues).toContainEqual(
      expect.objectContaining({
        code: "SPECIFICATION_UNREADABLE",
        ref: { kind: "concept", concept: "Selecting" },
      }),
    );
  });

  test("loads a real TypeScript project into deterministic plain analysis data", () => {
    const repositoryRoot = applicationProject();
    const manifest = projectManifest();
    const options = {
      repositoryRoot,
      tsconfigPath: "tsconfig.json",
      sourceRevision: "revision-1",
      manifest,
      manifestSourceRevision: "revision-1",
      expectedManifestDigest: manifest.digest,
    } as const;
    const first = loadApplicationProject(options);
    const second = loadApplicationProject(options);

    expect(first).toMatchObject({
      format: "sync-engine.application-project-analysis",
      version: 1,
      provenance: {
        sourceRevision: "revision-1",
        manifestSourceRevision: "revision-1",
        manifestDigest: manifest.digest,
        tsconfigPath: "tsconfig.json",
        typescriptVersion: ts.version,
      },
      applicationIndex: { format: "sync-engine.application-index", version: 1 },
      sourceIndex: { format: "sync-engine.application-source-index", version: 1 },
    });
    expect(first.provenance.files).toEqual(second.provenance.files);
    expect(first.provenance.sourceDigest).toBe(second.provenance.sourceDigest);
    expect(first.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.provenance.files.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    expect(first.provenance.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "src/concept.ts",
        "src/diagnostic.ts",
        "src/endpoint.ts",
        "src/index.ts",
        "src/reactions.ts",
        "src/selecting.md",
        "tsconfig.json",
      ]),
    );

    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({
        phase: "semantic",
        category: "error",
        code: 2322,
        path: "src/diagnostic.ts",
        line: 1,
      }),
    );
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);

    const select = first.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Select",
    );
    expect(select?.sources[0]?.range.path).toBe("src/reactions.ts");
    expect(select?.sources[0]?.text).toContain("export const Select = react");

    const endpoint = first.sourceIndex.entries.find(({ ref }) => ref.kind === "endpoint");
    const endpointSource = endpoint?.sources[0];
    expect(endpointSource).toBeDefined();
    expect(
      designRefsForSourceRange(first.sourceIndex, {
        path: endpointSource!.range.path,
        startOffset: endpointSource!.range.start.offset,
        endOffset: endpointSource!.range.end.offset,
      }),
    ).toEqual([
      {
        kind: "endpoint",
        endpoint: "ChooseEndpoint",
        path: "/selections/choose",
      },
      { kind: "reaction", reaction: "ChooseEndpoint" },
    ]);
  });

  test("rejects stale provenance, digest expectations, path escape, and changing reads", () => {
    const repositoryRoot = applicationProject();
    const manifest = projectManifest();
    const options = {
      repositoryRoot,
      tsconfigPath: "tsconfig.json",
      sourceRevision: "revision-1",
      manifest,
      manifestSourceRevision: "revision-1",
      expectedManifestDigest: manifest.digest,
    } as const;

    expect(() =>
      loadApplicationProject({ ...options, manifestSourceRevision: "revision-0" }),
    ).toThrow(/sourceRevision.*manifestSourceRevision/);
    expect(() =>
      loadApplicationProject({ ...options, expectedManifestDigest: "stale-digest" }),
    ).toThrow(/expectedManifestDigest.*manifest digest/);
    expect(() => loadApplicationProject({ ...options, tsconfigPath: "../tsconfig.json" })).toThrow(
      /tsconfigPath escapes repositoryRoot/,
    );

    const changingPath = join(repositoryRoot, "src/reactions.ts");
    let reactionReads = 0;
    expect(() =>
      loadApplicationProject({
        ...options,
        readFile: (path) => {
          let text: string;
          try {
            text = readFileSync(path, "utf8");
          } catch {
            return undefined;
          }
          if (path !== changingPath) return text;
          reactionReads += 1;
          return reactionReads === 1 ? text : `${text}\n// changed during analysis\n`;
        },
      }),
    ).toThrow(/project file changed during analysis: src\/reactions\.ts/);
  });
});
