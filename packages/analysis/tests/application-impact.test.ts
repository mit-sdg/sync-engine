import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applicationManifestDigest,
  parseConceptSpecification,
  type ApplicationManifestV5,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisAbortedError,
  AnalysisLimitError,
  applicationProjectAnalysisDigest,
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

function redigest(manifest: ApplicationManifestV5): ApplicationManifestV5 {
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

function fixture(): ApplicationManifestV5 {
  const manifest: ApplicationManifestV5 = {
    format: "sync-engine.application-manifest",
    version: 5,
    generator: { name: "@mit-sdg/sync-engine", version: "1.0.0-beta.6" },
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
            { op: "holds", computation: "ge", in: { left: 1, right: 0 } },
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
    computations: [
      { name: "among", source: "standard" },
      { name: "ge", source: "standard", inputs: ["left", "right"] },
      { name: "gt", source: "standard" },
      { name: "le", source: "standard" },
      { name: "lt", source: "standard" },
      { name: "unused vocabulary", source: "vocabulary", inputs: ["value"] },
    ],
    conceptImplementations: [
      {
        concept: "RequestBoundary",
        canonical: { owner: "core", constructorName: "RequestBoundaryConcept" },
        selected: { via: "core" },
      },
      {
        concept: "Alerting",
        canonical: { owner: "application", constructorName: "AlertingConcept" },
        selected: { via: "default" },
      },
      {
        concept: "Discussing",
        canonical: { owner: "application", constructorName: "DiscussingConcept" },
        selected: { via: "default" },
      },
      {
        concept: "Selecting",
        canonical: { owner: "application", constructorName: "SelectingConcept" },
        selected: { via: "default" },
      },
      {
        concept: "Unrelated",
        canonical: { owner: "application", constructorName: "UnrelatedConcept" },
        selected: { via: "default" },
      },
    ],
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
    wire: {
      endpoints: [
        {
          path: "/selections/choose",
          input: {
            kind: "object",
            fields: [{ key: "item", type: { kind: "json" } }],
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
        definition: { kind: "reaction", name: "LocalRepair" },
        message: "LocalRepair retains only known structure.",
      },
    ],
  };
  return redigest(manifest);
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
  export function assemble<T>(options: T): T;
  export function conceptSet<T, U>(registrations: T, computations?: U): { vocabulary: unknown; concepts: any };
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
    `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  AlertingConcept,
  DiscussingConcept,
  SelectingConcept,
  UnrelatedConcept,
  selecting,
} from "./concept.ts";
import * as reactions from "./reactions.ts";
import * as boundary from "./endpoint.ts";

const projectConcepts = conceptSet(
  {
    Alerting: registerConcept({ class: AlertingConcept, spec: "# Alerting" }),
    Discussing: registerConcept({ class: DiscussingConcept, spec: "# Discussing" }),
    Selecting: selecting,
    Unrelated: registerConcept({ class: UnrelatedConcept, spec: "# Unrelated" }),
  },
  { "unused vocabulary": ({ value }: { value: unknown }) => value },
);
const { vocabulary } = projectConcepts;
export const application = assemble({
  vocabulary,
  composition: { ...reactions, ...boundary },
});
export * from "./concept.ts";
export * from "./reactions.ts";
export * from "./endpoint.ts";
import "./diagnostic.ts";
`,
  );
  return root;
}

function projectManifest(): ApplicationManifestV5 {
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
  return redigest(manifest);
}

const applicationSource = `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
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
const applicationConcepts = conceptSet(
  {
    Alerting: registerConcept({ class: AlertingConcept, spec: "# Alerting" }),
    Discussing: registerConcept({ class: DiscussingConcept, spec: "# Discussing" }),
    Selecting: selecting,
    Unrelated: registerConcept({ class: UnrelatedConcept, spec: "# Unrelated" }),
  },
  { "unused vocabulary": ({ value }: { value: unknown }) => value },
);
const { concepts, vocabulary } = applicationConcepts;
const { Selecting, Discussing, Alerting } = concepts;

export const ObserveCurrent = react(() => Selecting._current() && Alerting.raise({ subject: "x" }));
export const LocalRepair = react(() => Alerting.raise({ subject: "x" }) && Selecting.choose({ item: "repair" }));
export const currentSelection = view("current selection", () => Selecting._current());
export const selectionSummary = former("selection summary", () => Selecting._current());
export const SelectReaction = react(() => Selecting.choose({ item: "x" }) && Discussing.open({ subject: "x" }));
export const SelectEndpoint = endpoint("/selections/choose", () => Selecting.choose({ item: "x" }) && Discussing.open({ subject: "x" }));
export const ChooseEndpoint = endpoint("/selections/choose", () => Selecting.choose({ item: "x" }));
export const application = assemble({
  vocabulary,
  composition: {
    Select,
    ObserveCurrent,
    LocalRepair,
    currentSelection,
    selectionSummary,
    Select: SelectEndpoint,
  },
});
`;

describe("application impact analysis", () => {
  test("indexes structural, conservative, causal, endpoint, and opaque dependencies", () => {
    const manifest = fixture();
    const index = indexApplication(manifest);

    expect(index).toMatchObject({
      format: "sync-engine.application-index",
      version: 2,
      manifestDigest: manifest.digest,
      provenance: {
        analyzer: { name: "@mit-sdg/sync-engine-analysis" },
        manifest: {
          format: "sync-engine.application-manifest",
          version: 5,
          digest: manifest.digest,
          generator: manifest.generator,
        },
      },
    });
    expect(index.inventory).toContainEqual({
      kind: "computation",
      computation: "unused vocabulary",
    });
    expect(index.nodes).toEqual(index.inventory);
    expect(index.referencedOnly).toEqual([]);

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
        severity: "info",
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
    second.computations.reverse();
    second.endpoints.reverse();
    redigest(second);

    const firstIndex = indexApplication(first);
    const secondIndex = indexApplication(second);
    expect(secondIndex.inventory).toEqual(firstIndex.inventory);
    expect(secondIndex.referencedOnly).toEqual(firstIndex.referencedOnly);
    expect(secondIndex.nodes).toEqual(firstIndex.nodes);
    expect(secondIndex.edges).toEqual(firstIndex.edges);
    expect(secondIndex.issues).toEqual(firstIndex.issues);
    expect(secondIndex.resourceUsage).toEqual(firstIndex.resourceUsage);
  });

  test("separates V5 inventory from exact references reached only through IR", () => {
    const manifest = fixture();
    manifest.application.reactions.push({
      name: "UnknownRead",
      when: [],
      where: [
        {
          op: "find",
          query: { concept: "Selecting", query: "_missing" },
          in: {},
          out: {},
        },
      ],
      then: [],
    });
    redigest(manifest);

    const index = indexApplication(manifest);
    const missing: DesignRef = { kind: "query", concept: "Selecting", query: "_missing" };
    expect(index.inventory).not.toContainEqual(missing);
    expect(index.referencedOnly).toEqual([missing]);
    expect(index.nodes).toContainEqual(missing);
    expect(index.issues).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_REFERENCE", severity: "error", ref: missing }),
    );

    const trace = traceApplicationImpact(index, [missing]);
    const context = contextForImpact(manifest, index, trace);
    expect(context.referencedOnly).toEqual([missing]);
  });

  test("owns only listed endpoint stages and generated hash descendants", () => {
    const manifest = fixture();
    manifest.application.reactions.push({
      name: "Select:manual",
      when: [],
      where: [],
      then: [],
    });
    redigest(manifest);

    const endpointStages = indexApplication(manifest).edges.filter(
      ({ relation }) => relation === "endpoint-stage",
    );
    expect(endpointStages.map(({ to }) => to)).toEqual(
      expect.arrayContaining([
        { kind: "reaction", reaction: "Select" },
        { kind: "reaction", reaction: "Select#2" },
      ]),
    );
    expect(endpointStages).toHaveLength(2);
    expect(endpointStages).not.toContainEqual(
      expect.objectContaining({ to: { kind: "reaction", reaction: "Select:manual" } }),
    );
  });

  test("diagnoses an endpoint whose declared stage family is absent", () => {
    const manifest = fixture();
    manifest.endpoints[0].reactions = ["MissingStage"];
    redigest(manifest);

    expect(indexApplication(manifest).issues).toContainEqual(
      expect.objectContaining({
        code: "UNRESOLVED_ENDPOINT_STAGE",
        severity: "warning",
        ref: { kind: "endpoint", endpoint: "Select", path: "/selections/choose" },
      }),
    );
  });

  test("rejects malformed V5 and mismatched result compositions", () => {
    const malformed = fixture();
    malformed.digest = "stale";
    expect(() => indexApplication(malformed)).toThrow(/canonical digest/);

    const firstManifest = fixture();
    const firstIndex = indexApplication(firstManifest);
    const firstTrace = traceApplicationImpact(firstIndex, [choose]);
    const secondManifest = fixture();
    secondManifest.computations.push({ name: "another computation", source: "vocabulary" });
    redigest(secondManifest);
    expect(() => contextForImpact(secondManifest, firstIndex, firstTrace)).toThrow(
      /different application manifest/,
    );

    const malformedIndex = structuredClone(firstIndex);
    (malformedIndex.provenance.analyzer as { version: string }).version = "0.0.0";
    expect(() => traceApplicationImpact(malformedIndex, [choose])).toThrow(/different analyzer/);
  });

  test("enforces pre-abort and every hard graph construction limit without partial results", () => {
    const abort = new AbortController();
    abort.abort("stop");
    expect(() => indexApplication(fixture(), { signal: abort.signal })).toThrow(
      AnalysisAbortedError,
    );
    const baseline = indexApplication(fixture());
    for (const [limit, maximum] of [
      ["maxGraphNodes", baseline.resourceUsage.graphNodes - 1],
      ["maxGraphEdges", baseline.resourceUsage.graphEdges - 1],
      ["maxDiagnostics", baseline.resourceUsage.diagnostics - 1],
    ] as const) {
      let caught: unknown;
      try {
        indexApplication(fixture(), { limits: { [limit]: maximum } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AnalysisLimitError);
      expect(caught).toMatchObject({ limit, maximum, attempted: maximum + 1 });
    }
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
    expect(trace).toMatchObject({
      format: "sync-engine.impact-trace",
      version: 2,
      manifestDigest: index.manifestDigest,
      complete: true,
    });
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
    expect(context).toMatchObject({
      format: "sync-engine.impact-context",
      version: 2,
      complete: true,
      wire: {
        endpoints: [{ path: "/selections/choose" }],
        appWide: ["UNAVAILABLE"],
      },
    });
    expect(context.computations).toContainEqual(
      expect.objectContaining({ name: "ge", source: "standard" }),
    );
    expect(context.computations.map(({ name }) => name)).not.toContain("unused vocabulary");
    expect(context.conceptImplementations.map(({ concept }) => concept)).toEqual([
      "Alerting",
      "Discussing",
      "Selecting",
    ]);
  });

  test("reports unknown seeds and explicit trace limits", () => {
    const manifest = fixture();
    const index = indexApplication(manifest);
    const unknown = traceApplicationImpact(index, [{ kind: "reaction", reaction: "Missing" }]);
    expect(unknown.issues).toContainEqual(
      expect.objectContaining({
        code: "UNKNOWN_SEED",
        severity: "error",
        suggestions: expect.arrayContaining([{ kind: "reaction", reaction: "Select" }]),
      }),
    );
    expect(
      unknown.issues
        .find(({ code }) => code === "UNKNOWN_SEED")
        ?.suggestions?.every(({ kind }) => kind === "reaction"),
    ).toBe(true);
    expect(unknown.complete).toBe(false);

    const limited = traceApplicationImpact(index, [choose], { maxDepth: 0, maxNodes: 1 });
    expect(limited.affected).toHaveLength(1);
    expect(limited.issues).toContainEqual(
      expect.objectContaining({ code: "TRACE_LIMIT_REACHED", severity: "warning" }),
    );
    expect(limited.complete).toBe(false);
    expect(contextForImpact(manifest, index, limited).complete).toBe(false);

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
    redigest(manifest);
    const selectedSource = applicationSource.replace(
      "Select: SelectEndpoint,",
      "Select: SelectReaction,\n    ChooseEndpoint,",
    );
    const program = programFor({ "app.ts": selectedSource });
    const sourceIndex = indexApplicationSources({
      manifest,
      program,
      projectRoot: "/project",
      readFile: (path) => (path === "/project/spec.md" ? selectingSpec : undefined),
    });

    const action = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "action" && ref.concept === "Selecting" && ref.action === "choose",
    );
    expect(action?.sources.map(({ role }) => role)).toEqual([
      "canonical-contract",
      "selected-implementation",
      "specification",
    ]);
    expect(action?.sources.every(({ range }) => !range.path.startsWith("/"))).toBe(true);
    expect(action?.sources.every(({ digest }) => /^[a-f0-9]{64}$/.test(digest))).toBe(true);
    expect(sourceIndex).toMatchObject({
      format: "sync-engine.application-source-index",
      version: 2,
      manifestDigest: manifest.digest,
      provenance: { manifest: { version: 5, digest: manifest.digest } },
    });
    expect(sourceIndex.documents).toEqual([
      expect.objectContaining({
        path: "app.ts",
        length: selectedSource.length,
        byteLength: Buffer.byteLength(selectedSource, "utf8"),
      }),
      expect.objectContaining({
        path: "spec.md",
        length: selectingSpec.length,
        byteLength: Buffer.byteLength(selectingSpec, "utf8"),
      }),
    ]);

    const select = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Select",
    );
    expect(select?.sources[0]?.text).toContain("SelectReaction = react");
    const endpoint = sourceIndex.entries.find(({ ref }) => ref.kind === "endpoint");
    expect(endpoint?.sources[0]?.text).toContain("ChooseEndpoint = endpoint");
    expect(
      sourceIndex.entries.find(
        ({ ref }) => ref.kind === "concept" && ref.concept === "RequestBoundary",
      )?.sources,
    ).toEqual([]);
    expect(
      sourceIndex.entries.find(
        ({ ref }) => ref.kind === "computation" && ref.computation === "among",
      )?.sources,
    ).toEqual([]);
    expect(sourceIndex.issues).not.toContainEqual(
      expect.objectContaining({ ref: { kind: "concept", concept: "RequestBoundary" } }),
    );

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
    const duplicate = applicationSource.replace(
      "export const SelectReaction = react",
      "export const SelectReaction = react",
    );
    const sourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "a.ts": applicationSource, "b.ts": duplicate }),
      projectRoot: "/project",
      readFile: (path) => (path === "/project/spec.md" ? selectingSpec : undefined),
    });

    expect(sourceIndex.issues).toContainEqual(
      expect.objectContaining({
        code: "AMBIGUOUS_ASSEMBLY_SOURCE",
        severity: "warning",
      }),
    );
    expect(
      sourceIndex.entries.find(({ ref }) => ref.kind === "reaction" && ref.reaction === "Select")
        ?.sources,
    ).toEqual([]);
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
    redigest(manifest);
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

  test("enforces deduplicated source anchor and UTF-8 text limits", () => {
    const options = {
      manifest: fixture(),
      program: programFor({ "app.ts": applicationSource }),
      projectRoot: "/project",
      readFile: (path: string) => (path === "/project/spec.md" ? selectingSpec : undefined),
    };
    expect(() => indexApplicationSources({ ...options, limits: { maxSourceAnchors: 0 } })).toThrow(
      AnalysisLimitError,
    );
    expect(() => indexApplicationSources({ ...options, limits: { maxSourceAnchors: 10 } })).toThrow(
      AnalysisLimitError,
    );
    expect(() =>
      indexApplicationSources({ ...options, limits: { maxSourceTextBytes: 1 } }),
    ).toThrow(AnalysisLimitError);
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
        severity: "warning",
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
      version: 2,
      manifestDigest: manifest.digest,
      provenance: {
        analyzer: { name: "@mit-sdg/sync-engine-analysis" },
        manifest: {
          format: "sync-engine.application-manifest",
          version: 5,
          digest: manifest.digest,
          generator: manifest.generator,
        },
        sourceRevision: "revision-1",
        manifestSourceRevision: "revision-1",
        manifestDigest: manifest.digest,
        tsconfigPath: "tsconfig.json",
        typescriptVersion: ts.version,
      },
      applicationIndex: { format: "sync-engine.application-index", version: 2 },
      sourceIndex: { format: "sync-engine.application-source-index", version: 2 },
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
        severity: "error",
        category: "error",
        code: 2322,
        path: "src/diagnostic.ts",
        line: 1,
      }),
    );
    expect(first.manifestDiagnostics).toEqual(manifest.diagnostics);
    expect(first.resourceUsage).toMatchObject({
      graphNodes: first.applicationIndex.nodes.length,
      graphEdges: first.applicationIndex.edges.length,
      projectFiles: first.provenance.files.length,
    });
    expect(first.sourceIndex.documents).toContainEqual(
      expect.objectContaining({
        path: "src/selecting.md",
        length: selectingSpec.length,
        byteLength: Buffer.byteLength(selectingSpec, "utf8"),
      }),
    );
    expect(applicationProjectAnalysisDigest(first)).toBe(applicationProjectAnalysisDigest(second));
    expect(applicationProjectAnalysisDigest(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      applicationProjectAnalysisDigest({
        ...first,
        provenance: { ...first.provenance, sourceRevision: "revision-2" },
      }),
    ).toThrow(/revisions differ/);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);

    const select = first.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Select",
    );
    expect(select?.sources[0]?.range.path).toBe("src/reactions.ts");
    expect(select?.sources[0]?.text).toContain("Select = react");

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
    const abort = new AbortController();
    abort.abort();
    expect(() => loadApplicationProject({ ...options, signal: abort.signal })).toThrow(
      AnalysisAbortedError,
    );
    expect(() => loadApplicationProject({ ...options, limits: { maxProjectFiles: 1 } })).toThrow(
      AnalysisLimitError,
    );
    expect(() =>
      loadApplicationProject({ ...options, limits: { maxProjectFileBytes: 1 } }),
    ).toThrow(AnalysisLimitError);

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
