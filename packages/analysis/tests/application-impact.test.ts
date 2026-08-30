import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applicationManifestDigest,
  parseConceptSpecification,
  type ApplicationManifestV1,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisAbortedError,
  AnalysisLimitError,
  DEFAULT_ANALYSIS_RESOURCE_LIMITS,
  createApplicationAnalysis,
  designRefsForSourceRange,
  indexApplication,
  traceApplicationImpact,
  type DesignRef,
} from "@mit-sdg/sync-engine-analysis/ir";
import {
  applicationProjectAnalysisDigest,
  indexApplicationSources,
  loadApplicationProject,
} from "@mit-sdg/sync-engine-analysis/project";
import { afterEach, describe, expect, test } from "vite-plus/test";
import ts from "typescript";

function redigest(manifest: ApplicationManifestV1): ApplicationManifestV1 {
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

function fixture(): ApplicationManifestV1 {
  const manifest: ApplicationManifestV1 = {
    format: "sync-engine.application-manifest",
    version: 1,
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
    design: {
      version: 1,
      checked: false,
      sources: [],
      declarations: [],
      concepts: [],
      computations: [],
    },
  };
  return redigest(manifest);
}

const choose: DesignRef = { kind: "action", concept: "Selecting", action: "choose" };

function designDigest(text: string): string {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  return `sha256-${createHash("sha256").update(normalized).digest("hex")}`;
}

function authoredFixture(): {
  readonly manifest: ApplicationManifestV1;
  readonly files: Readonly<Record<string, string>>;
} {
  const specificationText = `# SharedNotes

## Purpose

Remember a note.

## Principle

Touching records the note.

## Types

\`\`\`types
\`\`\`

## State

\`\`\`state
Rule: notes
\`\`\`

## Actions

\`\`\`actions
touch(note: String) : return ()
  where true
  then
    record note
    return
\`\`\`

## Queries

\`\`\`queries
\`\`\`
`;
  const designText = `# Forum design

Touching a note updates the feed.[touch]

[touch]: reaction:Forum.notes.Touch
`;
  const specification = parseConceptSpecification(specificationText).specification!;
  const concepts = ["PrimaryNotes", "ArchiveNotes"].map((name) => ({
    name,
    purpose: specification.purpose,
    principle: specification.principle,
    actions: [{ name: "touch", roles: ["note"] }],
    queries: [],
    specification,
  }));
  const manifest: ApplicationManifestV1 = {
    format: "sync-engine.application-manifest",
    version: 1,
    generator: { name: "@mit-sdg/sync-engine", version: "1.0.0-beta.9" },
    digest: "pending",
    application: {
      reactions: [
        {
          name: "Touch#returned",
          authored: { kind: "reaction", identity: "Forum.notes.Touch" },
          when: [
            {
              kind: "action",
              concept: "PrimaryNotes",
              action: "touch",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [],
          then: [],
        },
      ],
      unlowered: [],
      views: [],
      formers: [],
    },
    concepts: [
      {
        name: "RequestBoundary",
        actions: [
          { name: "request", roles: ["path", "requestId"] },
          { name: "respond", roles: ["requestId"] },
        ],
        queries: [],
      },
      ...concepts,
    ],
    computations: ["among", "ge", "gt", "le", "lt"].map((name) => ({
      name,
      source: "standard" as const,
    })),
    conceptImplementations: [
      {
        concept: "RequestBoundary",
        canonical: { owner: "core", constructorName: "RequestBoundaryConcept" },
        selected: { via: "core" },
      },
      ...concepts.map(({ name }) => ({
        concept: name,
        canonical: { owner: "application" as const, constructorName: "SharedNotes" },
        selected: { via: "default" as const },
      })),
    ],
    endpoints: [],
    inputContracts: {},
    wire: { endpoints: [], appWide: [] },
    diagnostics: [],
    design: {
      version: 1,
      checked: true,
      sources: [
        {
          id: "document-1",
          kind: "document",
          path: "../design/forum.md",
          digest: designDigest(designText),
          title: "Forum design",
        },
        {
          id: "concept-1",
          kind: "concept",
          path: "../design/SharedNotes.md",
          digest: designDigest(specificationText),
          definition: "SharedNotes",
          line: 1,
        },
      ],
      declarations: [
        {
          kind: "reaction",
          identity: "Forum.notes.Touch",
          runtimeNames: ["Touch#returned"],
          coverage: [{ source: "document-1", line: 3, column: 34 }],
        },
      ],
      concepts: [
        {
          definition: "SharedNotes",
          source: "concept-1",
          specification,
          ownedTypes: [],
          instances: concepts.map(({ name }) => ({
            name,
            declaration: { source: "document-1", line: 3, column: 1 },
            bindings: [],
          })),
        },
      ],
      computations: [],
    },
  };
  return {
    manifest: redigest(manifest),
    files: {
      [resolve("/project", "design", "forum.md")]: designText,
      [resolve("/project", "design", "SharedNotes.md")]: specificationText,
    },
  };
}

const selectingSpec = `# Selecting

## Purpose

Keep one current selection.

## Principle

Choosing an item makes it current.

## Types

\`\`\`types
external Item
\`\`\`

## State

\`\`\`state
Rule: one current Item
\`\`\`

## Actions

\`\`\`actions
choose(item: Item) : return (item: Item)
  where true
  then
    make item current
    return item
\`\`\`

## Queries

\`\`\`queries
_current() : optional (item: Item)
\`\`\`
`;
const virtualSpecificationPath = resolve("/project/spec.md");

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

function projectManifest(): ApplicationManifestV1 {
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
  const selecting = manifest.concepts.find(({ name }) => name === "Selecting")!;
  const specification = parseConceptSpecification(selectingSpec).specification!;
  selecting.purpose = specification.purpose;
  selecting.principle = specification.principle;
  selecting.specification = specification;
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
const applicationConceptSet = conceptSet(
  {
    Alerting: registerConcept({ class: AlertingConcept, spec: "# Alerting" }),
    Discussing: registerConcept({ class: DiscussingConcept, spec: "# Discussing" }),
    Selecting: selecting,
    Unrelated: registerConcept({ class: UnrelatedConcept, spec: "# Unrelated" }),
  },
  { "unused vocabulary": ({ value }: { value: unknown }) => value },
);
const { concepts, vocabulary } = applicationConceptSet;
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
  test("publishes every literal construction default", () => {
    expect(DEFAULT_ANALYSIS_RESOURCE_LIMITS).toEqual({
      maxGraphNodes: 100_000,
      maxGraphEdges: 500_000,
      maxDiagnostics: 10_000,
      maxSourceDocuments: 20_000,
      maxSourceAnchors: 100_000,
      maxStaticResolutionDepth: 32,
      maxStaticResolutionAlternatives: 32,
      maxAstCandidates: 1_000_000,
      maxAstNodes: 1_000_000,
      maxProjectFiles: 20_000,
      maxProjectFileBytes: 16_777_216,
      maxProjectTotalBytes: 268_435_456,
    });
  });

  test("indexes structural, conservative, causal, endpoint, and opaque dependencies", () => {
    const manifest = fixture();
    const index = indexApplication(manifest);

    expect(index).toMatchObject({
      format: "sync-engine.application-index",
      version: 3,
      manifestDigest: manifest.digest,
      provenance: {
        analyzer: { name: "@mit-sdg/sync-engine-analysis" },
        manifest: {
          format: "sync-engine.application-manifest",
          version: 1,
          digest: manifest.digest,
          generator: manifest.generator,
        },
      },
    });
    expect(index.inventory).toContainEqual({
      kind: "computation",
      computation: "unused vocabulary",
    });
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.edges)).toBe(true);
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

  test("separates V1 inventory from exact references reached only through IR", () => {
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
    expect(trace.seeds).toEqual([missing]);
  });

  test("uses shared concept definitions, authored lowering, and manifest design sources", async () => {
    const { manifest, files } = authoredFixture();
    const index = indexApplication(manifest);
    expect(index.inventory).toEqual(
      expect.arrayContaining([
        { kind: "concept", concept: "PrimaryNotes" },
        { kind: "concept", concept: "ArchiveNotes" },
        { kind: "reaction", reaction: "Forum.notes.Touch" },
      ]),
    );
    expect(index.inventory).not.toContainEqual({
      kind: "reaction",
      reaction: "Touch#returned",
    });

    const sourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "app.ts": "export {};\n" }),
      projectRoot: "/project",
      designSourceBasePath: "generated",
      readFile: (path) => files[path],
    });
    const authored = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Forum.notes.Touch",
    );
    expect(authored?.sources).toContainEqual(
      expect.objectContaining({
        role: "design-coverage",
        resolution: "manifest-provenance",
        range: expect.objectContaining({ path: "design/forum.md" }),
      }),
    );
    for (const concept of ["PrimaryNotes", "ArchiveNotes"]) {
      const conceptSources = sourceIndex.entries.find(
        ({ ref }) => ref.kind === "concept" && ref.concept === concept,
      )?.sources;
      expect(conceptSources).toContainEqual(
        expect.objectContaining({
          role: "specification",
          resolution: "manifest-provenance",
          range: expect.objectContaining({ path: "design/SharedNotes.md" }),
        }),
      );
      expect(conceptSources).toContainEqual(
        expect.objectContaining({
          role: "design-coverage",
          resolution: "manifest-provenance",
          range: expect.objectContaining({ path: "design/forum.md" }),
        }),
      );
    }
    expect(sourceIndex.issues).not.toContainEqual(
      expect.objectContaining({ code: "DESIGN_SOURCE_MISMATCH" }),
    );
    const staleSourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "app.ts": "export {};\n" }),
      projectRoot: "/project",
      designSourceBasePath: "generated",
      readFile: (path) =>
        path === resolve("/project", "design", "forum.md") ? `${files[path]}stale\n` : files[path],
    });
    expect(staleSourceIndex.issues).toContainEqual(
      expect.objectContaining({ code: "DESIGN_SOURCE_MISMATCH" }),
    );

    const analysis = createApplicationAnalysis({ manifest });
    const described = await analysis.describe({
      ref: { kind: "concept", concept: "PrimaryNotes" },
      detail: "definition",
    });
    expect(described.definition).toMatchObject({
      kind: "concept",
      design: {
        definition: "SharedNotes",
        instances: [{ name: "PrimaryNotes" }, { name: "ArchiveNotes" }],
      },
    });
    const reaction = await analysis.describe({
      ref: { kind: "reaction", reaction: "Forum.notes.Touch" },
      detail: "definition",
    });
    expect(reaction.definition).toMatchObject({
      kind: "reaction",
      identity: "Forum.notes.Touch",
      declaration: { runtimeNames: ["Touch#returned"] },
      reactions: [{ name: "Touch#returned" }],
    });
  });

  test("groups lowered runtime names under authored declaration identities", () => {
    const manifest = fixture();
    manifest.application.reactions[0].authored = {
      kind: "reaction",
      identity: "Forum.selection.Select",
    };
    manifest.application.reactions[1].authored = {
      kind: "reaction",
      identity: "Forum.selection.Select",
    };
    manifest.application.views[0].authored = {
      kind: "view",
      identity: "Forum.selection.Current",
    };
    manifest.application.formers[0].authored = {
      kind: "former",
      identity: "Forum.selection.Summary",
    };
    redigest(manifest);

    const index = indexApplication(manifest);
    expect(index.inventory).toContainEqual({
      kind: "reaction",
      reaction: "Forum.selection.Select",
    });
    expect(index.inventory).not.toContainEqual({ kind: "reaction", reaction: "Select#2" });
    expect(index.edges).toContainEqual(
      expect.objectContaining({
        from: { kind: "reaction", reaction: "Forum.selection.Select" },
        to: { kind: "endpoint", endpoint: "Select", path: "/selections/choose" },
        relation: "stage-affects-endpoint",
      }),
    );
    expect(index.edges).toContainEqual(
      expect.objectContaining({
        from: { kind: "view", view: "Forum.selection.Current" },
        to: { kind: "reaction", reaction: "Forum.selection.Select" },
      }),
    );
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

  test("rejects old manifests, malformed V1, and malformed index provenance", () => {
    const old = { ...fixture(), version: 5 };
    expect(() => indexApplication(old as unknown as ApplicationManifestV1)).toThrow(
      /version.*expected 1|version 1|version.*unsupported/i,
    );

    const malformed = fixture();
    malformed.digest = "stale";
    expect(() => indexApplication(malformed)).toThrow(/canonical digest/);

    const forgedOwnedTypes = authoredFixture().manifest;
    forgedOwnedTypes.design.concepts[0]!.ownedTypes = ["Invented"];
    redigest(forgedOwnedTypes);
    expect(() => indexApplication(forgedOwnedTypes)).toThrow(/ownedTypes.*independently derived/);

    const firstManifest = fixture();
    const firstIndex = indexApplication(firstManifest);
    const malformedIndex = structuredClone(firstIndex);
    (malformedIndex.provenance.analyzer as { version: string }).version = "0.0.0";
    expect(() => traceApplicationImpact(malformedIndex, [choose])).not.toThrow();
    const wrongName = structuredClone(firstIndex);
    (wrongName.provenance.analyzer as { name: string }).name = "other";
    expect(() => traceApplicationImpact(wrongName, [choose])).toThrow(/malformed analyzer/);
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
      version: 3,
      manifestDigest: index.manifestDigest,
      complete: true,
    });
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.affected)).toBe(true);
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
      readFile: (path) => (path === virtualSpecificationPath ? selectingSpec : undefined),
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
      version: 3,
      manifestDigest: manifest.digest,
      provenance: { manifest: { version: 1, digest: manifest.digest } },
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
    expect(select?.sources[0]?.range.path).toBe("app.ts");
    expect(select?.sources[0]).not.toHaveProperty("text");
    const endpoint = sourceIndex.entries.find(({ ref }) => ref.kind === "endpoint");
    expect(endpoint?.sources[0]?.range.path).toBe("app.ts");
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

    expect(
      sourceIndex.entries.some(({ ref, sources }) => ref.kind === "action" && sources.length > 0),
    ).toBe(true);
    expect(sourceIndex.issues).not.toContainEqual(
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
      readFile: (path) => (path === virtualSpecificationPath ? selectingSpec : undefined),
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
    const parsed = parseConceptSpecification(selectingSpec).specification!;
    const reordered = {
      queries: parsed.queries,
      actions: parsed.actions,
      state: parsed.state,
      externalTypes: parsed.externalTypes,
      localTypes: parsed.localTypes,
      principle: parsed.principle,
      purpose: parsed.purpose,
      definitionName: parsed.definitionName,
      version: parsed.version,
      format: parsed.format,
    } as typeof parsed;
    const selecting = manifest.concepts.find(({ name }) => name === "Selecting")!;
    selecting.purpose = reordered.purpose;
    selecting.principle = reordered.principle;
    selecting.specification = reordered;
    redigest(manifest);
    const sourceIndex = indexApplicationSources({
      manifest,
      program: programFor({ "app.ts": applicationSource }),
      projectRoot: "/project",
      readFile: (path) => (path === virtualSpecificationPath ? selectingSpec : undefined),
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
      readFile: (path: string) => (path === virtualSpecificationPath ? selectingSpec : undefined),
    };
    expect(() => indexApplicationSources({ ...options, limits: { maxSourceAnchors: 0 } })).toThrow(
      AnalysisLimitError,
    );
    expect(() => indexApplicationSources({ ...options, limits: { maxSourceAnchors: 10 } })).toThrow(
      AnalysisLimitError,
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
        severity: "warning",
        ref: { kind: "concept", concept: "Selecting" },
      }),
    );
  });

  test("loads a real TypeScript project into deterministic plain analysis data", async () => {
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
      version: 3,
      manifestDigest: manifest.digest,
      provenance: {
        analyzer: { name: "@mit-sdg/sync-engine-analysis" },
        manifest: {
          format: "sync-engine.application-manifest",
          version: 1,
          digest: manifest.digest,
          generator: manifest.generator,
        },
        sourceRevision: "revision-1",
        manifestSourceRevision: "revision-1",
        manifestDigest: manifest.digest,
        tsconfigPath: "tsconfig.json",
        typescriptVersion: ts.version,
      },
      applicationIndex: { format: "sync-engine.application-index", version: 3 },
      sourceIndex: { format: "sync-engine.application-source-index", version: 3 },
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
    expect(select?.sources[0]).not.toHaveProperty("text");

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

    const analysis = createApplicationAnalysis({
      manifest,
      project: first,
      expectedProjectDigest: applicationProjectAnalysisDigest(first),
    });
    const definitions = await Promise.all(
      analysis.index.inventory.map((ref) => analysis.describe({ ref })),
    );
    expect(new Set(definitions.map(({ definition }) => definition?.kind))).toEqual(
      new Set([
        "concept",
        "action",
        "query",
        "reaction",
        "view",
        "former",
        "computation",
        "endpoint",
      ]),
    );

    const catalogResults = await Promise.all([
      analysis.catalog({ filters: { kinds: ["reaction"], portability: ["unlowered"] } }),
      analysis.catalog({ filters: { concepts: ["Selecting"] } }),
      analysis.catalog({ filters: { sourceAvailability: ["available"] } }),
      analysis.catalog({ filters: { diagnosticSeverities: ["info"] } }),
    ]);
    expect(catalogResults.every(({ complete }) => complete)).toBe(true);

    const searches = await Promise.all([
      analysis.search({ query: "choose", fields: ["identity"] }),
      analysis.search({ query: "Selec", fields: ["identity"] }),
      analysis.search({ query: "Selecting choose", fields: ["identity"] }),
      analysis.search({ query: "uses a local closure", fields: ["contract"] }),
      analysis.search({ query: "src/reactions.ts", fields: ["source-path"] }),
    ]);
    expect(searches[0].items[0]).toMatchObject({ ref: choose, rank: 1 });
    expect(searches.some(({ total }) => total > 0)).toBe(true);

    const reactionSource = first.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "Select",
    )!.sources[0];
    const sourceResults = await Promise.all([
      analysis.sources({ query: { kind: "file", path: reactionSource.range.path } }),
      analysis.sources({
        query: {
          kind: "range",
          path: reactionSource.range.path,
          start: reactionSource.range.start.offset,
          end: reactionSource.range.end.offset,
        },
        roles: [reactionSource.role],
        resolutions: [reactionSource.resolution],
        match: "best",
      }),
    ]);
    expect(sourceResults.every(({ total }) => total > 0)).toBe(true);

    const limitedImpact = await analysis.impact({
      seeds: [choose],
      relations: ["action-trigger"],
      certainties: ["structural"],
      maxDepth: 0,
      maxNodes: 1,
    });
    expect(limitedImpact.complete).toBe(false);
    expect(limitedImpact.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TRACE_LIMIT_REACHED" }),
    );
    const incoming = await analysis.navigate({
      ref: choose,
      direction: "incoming",
      relations: ["concept-member"],
      certainties: ["structural"],
      maxEdges: 0,
    });
    expect(incoming.complete).toBe(false);

    const projectDiagnostics = await analysis.diagnostics({
      filters: {
        origins: ["typescript"],
        severities: ["error"],
        codes: ["2322"],
        pathPrefixes: ["src/"],
      },
    });
    expect(projectDiagnostics.items).toHaveLength(1);
    expect(
      (
        await analysis.diagnostics({
          filters: { refs: [{ kind: "reaction", reaction: "LocalRepair" }] },
        })
      ).total,
    ).toBeGreaterThan(0);

    const contracts = await analysis.contracts({
      filters: { endpoints: ["ChooseEndpoint"], paths: ["/selections/choose"] },
    });
    expect(contracts).toMatchObject({
      total: 1,
      appWide: manifest.wire.appWide,
    });
    expect(contracts.items[0]).toMatchObject({
      endpoint: { name: "ChooseEndpoint", path: "/selections/choose" },
      inputContract: manifest.inputContracts["/selections/choose"],
    });
    expect(contracts).not.toHaveProperty("rendered");
    expect(contracts).not.toHaveProperty("projections");
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

    const changingPath = realpathSync(join(repositoryRoot, "src/reactions.ts"));
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
