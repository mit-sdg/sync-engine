import {
  applicationManifestDigest,
  parseConceptSpecification,
  type ApplicationManifestV1,
} from "@mit-sdg/sync-engine/tooling";
import {
  AnalysisAbortedError,
  AnalysisLimitError,
  ApplicationSourceReadError,
  designRefKey,
  designRefsForSourceRange,
  queryApplicationSources,
  readApplicationSourceDocument,
  type ApplicationSourceIndex,
  type DesignRef,
  type SourceIndexIssueCode,
} from "@mit-sdg/sync-engine-analysis/ir";
import {
  indexApplicationSources,
  type SourceAttributionRoot,
} from "@mit-sdg/sync-engine-analysis/project";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import ts from "typescript";

const coreDeclarations = `declare module "@mit-sdg/sync-engine/advanced" {
  export function vocabulary<T>(declaration: T): any;
}
declare module "@mit-sdg/sync-engine/assembly" {
  export function assemble<T>(options: T): T;
  export function conceptSet<T, U>(registrations: T, computations?: U): {
    vocabulary: unknown;
    concepts: any;
    implementations(...args: any[]): Record<string, object>;
  };
  export function registerConcept<T>(registration: T): T;
}
declare module "@mit-sdg/sync-engine/boundary" {
  export function endpoint<T>(path: string, declaration: T): T;
  export function endpointPrefix<T>(path: string, declaration: T): T;
}
declare module "@mit-sdg/sync-engine/language" {
  export function reaction<T>(declaration: T): T;
  export function view<T>(name: string, declaration: T): T;
  export function former<T>(name: string, declaration: T): T;
}
declare module "*.md" { const text: string; export default text; }
`;

type ManifestSelection = ApplicationManifestV1["conceptImplementations"][number]["selected"];

interface ManifestOptions {
  readonly concepts: readonly {
    readonly name: string;
    readonly actions?: readonly string[];
    readonly queries?: readonly string[];
    readonly constructorName?: string;
    readonly selected?: ManifestSelection;
    readonly specification?: ApplicationManifestV1["concepts"][number]["specification"];
  }[];
  readonly reactions?: readonly string[];
  readonly views?: readonly string[];
  readonly formers?: readonly string[];
  readonly endpoints?: readonly {
    readonly name: string;
    readonly path: string;
    readonly reactions: readonly string[];
  }[];
  readonly computations?: readonly string[];
}

function manifestFor(options: ManifestOptions): ApplicationManifestV1 {
  const endpoints = options.endpoints ?? [];
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
      ...options.concepts.map((concept) => ({
        name: concept.name,
        actions:
          concept.specification?.actions.map(({ name, refusals }) => ({
            name,
            refusals: refusals.map(({ code }) => code).sort(),
          })) ?? (concept.actions ?? ["run"]).map((name) => ({ name })),
        queries:
          concept.specification?.queries.map(({ name, promise }) => ({
            name,
            returns: promise,
          })) ?? (concept.queries ?? ["_read"]).map((name) => ({ name })),
        ...(concept.specification === undefined
          ? {}
          : {
              purpose: concept.specification.purpose,
              principle: concept.specification.principle,
              specification: concept.specification,
            }),
      })),
    ],
    conceptImplementations: [
      {
        concept: "RequestBoundary",
        canonical: { owner: "core", constructorName: "RequestBoundaryConcept" },
        selected: { via: "core" },
      },
      ...options.concepts.map((concept) => ({
        concept: concept.name,
        canonical: {
          owner: "application" as const,
          constructorName: concept.constructorName ?? `${concept.name}Canonical`,
        },
        selected: concept.selected ?? ({ via: "default" } as const),
      })),
    ],
    computations: [
      { name: "among", source: "standard" },
      { name: "ge", source: "standard" },
      { name: "gt", source: "standard" },
      { name: "le", source: "standard" },
      { name: "lt", source: "standard" },
      ...(options.computations ?? []).map((name) => ({ name, source: "vocabulary" as const })),
    ],
    application: {
      reactions: (options.reactions ?? []).map((name) => ({ name, when: [], where: [], then: [] })),
      unlowered: [],
      views: (options.views ?? []).map((name) => ({
        name,
        ins: [],
        outs: [],
        bindings: [],
        alternatives: [],
      })),
      formers: (options.formers ?? []).map((name) => ({
        name,
        ins: [],
        bindings: [],
        promise: "optional" as const,
        body: { node: "record" as const, entries: {} },
      })),
    },
    endpoints: endpoints.map((endpoint) => ({
      ...endpoint,
      reactions: [...endpoint.reactions],
      input: {},
      validators: { input: false, output: false },
    })),
    inputContracts: Object.fromEntries(endpoints.map(({ path }) => [path, {}])),
    wire: {
      endpoints: [...new Set(endpoints.map(({ path }) => path))].map((path) => ({
        path,
        input: { kind: "json" as const },
        output: { kind: "json" as const },
        errors: [],
        openError: false,
      })),
      appWide: [],
    },
    diagnostics: [],
    design: {
      version: 1,
      checked: false,
      sources: [],
      declarations: [],
      concepts: [],
      computations: [],
    },
  };
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

const programsBySource = new Map<string, ts.Program>();

function programFor(files: Readonly<Record<string, string>>): ts.Program {
  const cacheKey = JSON.stringify(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
  const cached = programsBySource.get(cacheKey);
  if (cached !== undefined) return cached;

  const sources = new Map<string, string>([["/project/core.d.ts", coreDeclarations]]);
  for (const [path, text] of Object.entries(files)) {
    sources.set(path.startsWith("/") ? path : `/project/${path}`, text);
  }
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    strict: true,
    skipLibCheck: true,
  };
  const base = ts.createCompilerHost(compilerOptions, true);
  const directories = new Set<string>(["/", "/project"]);
  for (const path of sources.keys()) {
    const parts = path.split("/");
    for (let index = 2; index < parts.length; index += 1) {
      directories.add(`/${parts.slice(1, index).join("/")}`);
    }
  }
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (path) => sources.has(path) || base.fileExists(path),
    readFile: (path) => sources.get(path) ?? base.readFile(path),
    directoryExists: (path) => directories.has(path) || base.directoryExists?.(path) === true,
    getDirectories: (path) => base.getDirectories?.(path) ?? [],
    getSourceFile: (path, languageVersion) => {
      const text = sources.get(path);
      return text === undefined
        ? base.getSourceFile(path, languageVersion)
        : ts.createSourceFile(path, text, languageVersion, true, ts.ScriptKind.TS);
    },
    getCurrentDirectory: () => "/project",
    writeFile: () => undefined,
  };
  const program = ts.createProgram({
    rootNames: [...sources.keys()],
    options: compilerOptions,
    host,
  });
  programsBySource.set(cacheKey, program);
  return program;
}

function index(
  manifest: ApplicationManifestV1,
  files: Readonly<Record<string, string>>,
  options: Partial<Parameters<typeof indexApplicationSources>[0]> = {},
): ApplicationSourceIndex {
  return indexApplicationSources({
    manifest,
    program: programFor(files),
    projectRoot: "/project",
    ...options,
  });
}

function sourcesFor(sourceIndex: ApplicationSourceIndex, ref: DesignRef) {
  return (
    sourceIndex.entries.find((entry) => JSON.stringify(entry.ref) === JSON.stringify(ref))
      ?.sources ?? []
  );
}

describe("symbol-aware application source index", () => {
  test("recognizes endpointPrefix as an endpoint declaration source", () => {
    const manifest = manifestFor({
      concepts: [],
      reactions: ["WelcomeSpace"],
      endpoints: [{ name: "WelcomeSpace", path: "/welcome/", reactions: ["WelcomeSpace"] }],
    });
    const sourceIndex = index(manifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { endpointPrefix } from "@mit-sdg/sync-engine/boundary";
const words = vocabulary({ concepts: {}, computations: {} });
const WelcomeSpace = endpointPrefix("/welcome/", () => null);
assemble({ vocabulary: words, composition: { WelcomeSpace } });
`,
    });

    expect(
      sourcesFor(sourceIndex, {
        kind: "endpoint",
        endpoint: "WelcomeSpace",
        path: "/welcome/",
      })[0]?.range.path,
    ).toBe("app.ts");
    expect(sourceIndex.issues).not.toContainEqual(
      expect.objectContaining({ code: "UNRESOLVED_DESIGN_SOURCE" }),
    );
  });

  test("follows aliases, namespaces, barrels, export-star, namespace re-exports, and rejects shadows", () => {
    const manifest = manifestFor({
      concepts: [{ name: "Logical", constructorName: "OddClass" }],
      reactions: ["nested.React"],
      views: ["authored view"],
      formers: ["authored former"],
      endpoints: [{ name: "nested.Route", path: "/same", reactions: ["nested.Route"] }],
    });
    const sourceIndex = index(manifest, {
      "barrel.ts": `export { vocabulary } from "@mit-sdg/sync-engine/advanced";
export { assemble } from "@mit-sdg/sync-engine/assembly";
export { reaction as declareReaction, view } from "@mit-sdg/sync-engine/language";
export { endpoint } from "@mit-sdg/sync-engine/boundary";
export * as language from "@mit-sdg/sync-engine/language";
`,
      "star.ts": `export * from "./barrel.ts";`,
      "composition.ts": `import * as api from "./star.ts";
import { declareReaction, language } from "./star.ts";
const react = declareReaction;
const { former: shape } = language;
export const React = react(() => null);
export const Route = api.endpoint("/same", () => null);
export const Read = api.view("authored view", () => null);
export const Shape = shape("authored former", () => null);
function reaction(value: unknown) { return value; }
export const shadow = reaction(() => "not a declaration");
`,
      "app.ts": `import { assemble, vocabulary } from "./star.ts";
import * as nested from "./composition.ts";
class OddClass { run() {} _read() {} }
const words = vocabulary({ concepts: { Logical: OddClass }, computations: {} });
export const application = assemble({ vocabulary: words, composition: { nested } });
`,
    });

    expect(sourceIndex.issues).toEqual([]);
    expect(
      sourcesFor(sourceIndex, { kind: "reaction", reaction: "nested.React" })[0]?.range.path,
    ).toBe("composition.ts");
    expect(
      sourcesFor(sourceIndex, {
        kind: "endpoint",
        endpoint: "nested.Route",
        path: "/same",
      })[0]?.range.path,
    ).toBe("composition.ts");
    expect(sourceIndex.entries.some(({ ref }) => designRefKey(ref).includes("shadow"))).toBe(false);
  });

  test("uses exact public imports when resolved module exports omit declarations", () => {
    const manifest = manifestFor({ concepts: [], reactions: ["React"] });
    const sourceIndex = index(manifest, {
      "core.d.ts": `declare module "@mit-sdg/sync-engine/advanced" {
  export const placeholder: unknown;
}
declare module "@mit-sdg/sync-engine/assembly" {
  export const placeholder: unknown;
}
declare module "@mit-sdg/sync-engine/language" {
  export const placeholder: unknown;
}
`,
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction } from "@mit-sdg/sync-engine/language";
const React = reaction(() => null);
const words = vocabulary({ concepts: {}, computations: {} });
export const application = assemble({ vocabulary: words, composition: { React } });
`,
    });

    expect(sourceIndex.issues).toEqual([]);
    expect(
      sourcesFor(sourceIndex, { kind: "reaction", reaction: "React" }).some(
        ({ resolution }) => resolution === "literal-name",
      ),
    ).toBe(true);
  });

  test("maps arbitrary logical concept names without class spelling or unrelated-registration ambiguity", () => {
    const manifest = manifestFor({
      concepts: [
        { name: "first alias", constructorName: "Shared" },
        { name: "second-alias", constructorName: "Shared" },
        { name: "third", constructorName: "Shared" },
      ],
    });
    const sourceIndex = index(manifest, {
      "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
class Shared { run() {} _read() {} }
const one = registerConcept({ class: Shared, spec: "# one" });
const two = registerConcept({ class: Shared, spec: "# two" });
const unrelated = registerConcept({ class: Shared, spec: "# unrelated" });
const set = conceptSet({ "first alias": one, "second-alias": one, third: two });
const { vocabulary } = set;
export const application = assemble({ vocabulary, composition: {} });
void unrelated;
`,
    });

    expect(sourceIndex.issues).toEqual([]);
    for (const concept of ["first alias", "second-alias", "third"]) {
      const sources = sourcesFor(sourceIndex, { kind: "concept", concept });
      expect(sources.map(({ role }) => role)).toEqual([
        "canonical-contract",
        "declaration",
        "registration",
        "selected-implementation",
        "selection",
      ]);
      expect(sources.some(({ range }) => range.path === "app.ts")).toBe(true);
    }
  });

  test("reports missing and ambiguous registrations instead of selecting an alternative", () => {
    const missingManifest = manifestFor({ concepts: [{ name: "Missing" }] });
    const missing = index(missingManifest, {
      "app.ts": `import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
declare const dynamicRegistration: unknown;
const set = conceptSet({ Missing: dynamicRegistration });
const { vocabulary } = set;
assemble({ vocabulary, composition: {} });
`,
    });
    expect(missing.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_CONCEPT_REGISTRATION",
        ref: { kind: "concept", concept: "Missing" },
      }),
    );

    const ambiguousManifest = manifestFor({ concepts: [{ name: "Ambiguous" }] });
    const ambiguous = index(ambiguousManifest, {
      "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
class One { run() {} _read() {} }
class Two { run() {} _read() {} }
const one = registerConcept({ class: One, spec: "# one" });
const two = registerConcept({ class: Two, spec: "# two" });
declare const choose: boolean;
const selected = choose ? one : two;
const set = conceptSet({ Ambiguous: selected });
const { vocabulary } = set;
assemble({ vocabulary, composition: {} });
`,
    });
    expect(ambiguous.issues).toContainEqual(
      expect.objectContaining({
        code: "AMBIGUOUS_CONCEPT_REGISTRATION",
        ref: { kind: "concept", concept: "Ambiguous" },
      }),
    );
  });

  test("keeps canonical, initialized, factory, subclass, inherited, and object selections distinct", () => {
    const manifest = manifestFor({
      concepts: [
        { name: "Defaulted", constructorName: "DefaultCanonical", selected: { via: "default" } },
        {
          name: "Initialized",
          constructorName: "InitializedCanonical",
          selected: { via: "initialize" },
        },
        {
          name: "Explicit",
          constructorName: "ExplicitCanonical",
          selected: { via: "instances", constructorName: "ExplicitSelected" },
        },
        { name: "Objected", constructorName: "ObjectCanonical", selected: { via: "instances" } },
      ],
    });
    const sourceIndex = index(manifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
class Base { run() { return "base"; } }
class DefaultCanonical extends Base { _read() {} }
class InitializedCanonical extends Base { constructor(_value: string) { super(); } _read() {} }
class ExplicitCanonical extends Base { _read() {} }
class ExplicitSelected extends ExplicitCanonical { run() { return "selected"; } }
class ObjectCanonical extends Base { _read() {} }
function makeExplicit() { return new ExplicitSelected(); }
const words = vocabulary({
  concepts: { Defaulted: DefaultCanonical, Initialized: InitializedCanonical, Explicit: ExplicitCanonical, Objected: ObjectCanonical },
  computations: {},
});
const objectImplementation = { run() { return "object"; }, _read() {} };
assemble({
  vocabulary: words,
  initialize: { Initialized: ["value"] },
  instances: { Explicit: makeExplicit(), Objected: objectImplementation },
  composition: {},
});
`,
    });

    expect(sourceIndex.issues).toEqual([]);
    const defaultRun = sourcesFor(sourceIndex, {
      kind: "action",
      concept: "Defaulted",
      action: "run",
    });
    expect(defaultRun.map(({ role }) => role)).toEqual([
      "canonical-contract",
      "selected-implementation",
    ]);
    expect(defaultRun.every(({ range }) => range.path === "app.ts")).toBe(true);
    expect(
      sourcesFor(sourceIndex, { kind: "action", concept: "Explicit", action: "run" }).find(
        ({ role }) => role === "selected-implementation",
      )?.range.path,
    ).toBe("app.ts");
    expect(
      sourcesFor(sourceIndex, { kind: "action", concept: "Objected", action: "run" }).find(
        ({ role }) => role === "selected-implementation",
      )?.range.path,
    ).toBe("app.ts");
    expect(
      sourcesFor(sourceIndex, { kind: "concept", concept: "Initialized" }).some(
        ({ role, range }) => role === "selection" && range.path === "app.ts",
      ),
    ).toBe(true);
  });

  test("attributes named concept-set floors and refuses dynamic later instance spreads", () => {
    const floorManifest = manifestFor({
      concepts: [
        {
          name: "Storage",
          constructorName: "StorageCanonical",
          selected: { via: "instances", constructorName: "FloorStorage", floor: "production" },
        },
      ],
    });
    const floor = index(floorManifest, {
      "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
class StorageCanonical { run() {} _read() {} }
class FloorStorage extends StorageCanonical { run() { return "floor"; } }
const storage = registerConcept({ class: StorageCanonical, spec: "# storage", floors: { production: () => new FloorStorage() } });
const set = conceptSet({ Storage: storage });
const { vocabulary } = set;
assemble({ vocabulary, instances: set.implementations("production", {}), composition: {} });
`,
    });
    expect(floor.issues).toEqual([]);
    expect(
      sourcesFor(floor, { kind: "action", concept: "Storage", action: "run" }).find(
        ({ role }) => role === "selected-implementation",
      )?.range.path,
    ).toBe("app.ts");

    const unresolvedManifest = manifestFor({
      concepts: [
        {
          name: "Storage",
          constructorName: "StorageCanonical",
          selected: { via: "instances", constructorName: "FloorStorage" },
        },
      ],
    });
    const unresolved = index(unresolvedManifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
class StorageCanonical { run() {} _read() {} }
class FloorStorage extends StorageCanonical { run() { return "selected"; } }
declare const dynamic: Record<string, object>;
const words = vocabulary({ concepts: { Storage: StorageCanonical }, computations: {} });
assemble({ vocabulary: words, instances: { Storage: new FloorStorage(), ...dynamic }, composition: {} });
`,
    });
    expect(unresolved.issues).toContainEqual(
      expect.objectContaining({
        code: "UNRESOLVED_IMPLEMENTATION_SELECTION",
        ref: { kind: "concept", concept: "Storage" },
      }),
    );
    expect(
      sourcesFor(unresolved, { kind: "action", concept: "Storage", action: "run" }).some(
        ({ role }) => role === "selected-implementation",
      ),
    ).toBe(false);
  });

  test("uses exact roots, endpoint identities, focus ranking, CRLF ranges, verified reads, and cancellation", async () => {
    const specification =
      "# Odd\r\n\r\n## Purpose\r\n\r\nKeep an odd value.\r\n\r\n## Principle\r\n\r\nChoosing replaces it.\r\n\r\n## Types\r\n\r\n```types\r\nexternal Text\r\n```\r\n\r\n## State\r\n\r\n```state\r\none odd Text\r\n```\r\n\r\n## Actions\r\n\r\n```actions\r\nchoose(value: Text) : return (value: Text)\r\n  where true\r\n  then\r\n    replace the odd value\r\n    return value\r\n```\r\n\r\n## Queries\r\n\r\n```queries\r\n_read() : optional (value: Text)\r\n```\r\n";
    const parsed = parseConceptSpecification(specification.replaceAll("\r\n", "\n"));
    const manifest = manifestFor({
      concepts: [
        {
          name: "Odd",
          actions: ["choose"],
          queries: ["_read"],
          constructorName: "OddCanonical",
          specification: parsed,
        },
      ],
      reactions: ["event:manual", "first", "first#2", "nested.second"],
      endpoints: [
        { name: "first", path: "/same", reactions: ["first"] },
        { name: "nested.second", path: "/same", reactions: ["nested.second"] },
      ],
    });
    const files = {
      "shared.ts": `import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { endpoint } from "@mit-sdg/sync-engine/boundary";
import { reaction } from "@mit-sdg/sync-engine/language";
import spec from "./odd.md" with { type: "text" };
class OddCanonical { choose() { return "😀"; } _read() {} }
const odd = registerConcept({ class: OddCanonical, spec });
export const set = conceptSet({ Odd: odd });
export const manual = reaction(() => null);
export function compositionFactory() {
  const firstEndpoint = endpoint("/same", () => null);
  return { "event:manual": manual, first: firstEndpoint, nested: { second: endpoint("/same", () => null) } };
}
`,
      "one.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { set, compositionFactory } from "./shared.ts";
export function buildOne() { return assemble({ conceptSet: set, composition: compositionFactory() }); }
`,
      "two.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { set, compositionFactory } from "./shared.ts";
export function buildTwo() { return assemble({ conceptSet: set, composition: compositionFactory() }); }
`,
      "root.ts": `export { buildTwo as selected } from "./two.ts";`,
    };
    const sourceIndex = index(manifest, files, {
      sourceRoots: [{ path: "root.ts", exportName: "selected" }],
      readFile: (path) => (path === resolve("/project/odd.md") ? specification : undefined),
    });

    expect(sourceIndex.issues).toEqual([]);
    expect(
      sourcesFor(sourceIndex, { kind: "concept", concept: "Odd" }).find(
        ({ role }) => role === "selection",
      )?.range.path,
    ).toBe("two.ts");
    const first = sourcesFor(sourceIndex, {
      kind: "endpoint",
      endpoint: "first",
      path: "/same",
    });
    const second = sourcesFor(sourceIndex, {
      kind: "endpoint",
      endpoint: "nested.second",
      path: "/same",
    });
    expect(first[0]?.range.path).toBe("shared.ts");
    expect(second[0]?.range.path).toBe("shared.ts");
    expect(first[0]?.range.start.offset).not.toBe(second[0]?.range.start.offset);
    expect(sourcesFor(sourceIndex, { kind: "reaction", reaction: "event:manual" })).not.toEqual([]);
    expect(sourcesFor(sourceIndex, { kind: "reaction", reaction: "first#2" })[0]?.range.path).toBe(
      "shared.ts",
    );

    const choose = sourcesFor(sourceIndex, {
      kind: "action",
      concept: "Odd",
      action: "choose",
    });
    const method = choose.find(({ role }) => role === "canonical-contract")!;
    expect(method.focusRange?.start.offset).toBe(files["shared.ts"].indexOf("choose()"));
    const ranked = queryApplicationSources(
      sourceIndex,
      { kind: "cursor", path: "shared.ts", offset: method.focusRange!.start.offset },
      { match: "best" },
    );
    expect(Object.isFrozen(ranked)).toBe(true);
    expect(Object.isFrozen(ranked.matches)).toBe(true);
    expect(ranked.matches[0].specificity).toBe("focus");
    expect(ranked.matches[0].ref).toEqual({ kind: "action", concept: "Odd", action: "choose" });

    const specificationAnchor = choose.find(({ role }) => role === "specification")!;
    expect(specificationAnchor.range.end.offset).toBeGreaterThan(
      specificationAnchor.focusRange!.end.offset,
    );
    expect(specificationAnchor.range.end.line).toBe(31);
    const specificationRead = await readApplicationSourceDocument(sourceIndex, "odd.md", {
      readFile: () => specification,
    });
    expect(
      specificationRead.text.slice(
        specificationAnchor.range.start.offset,
        specificationAnchor.range.end.offset,
      ),
    ).toContain("choose(value: Text)");

    const shared = files["shared.ts"];
    await expect(
      readApplicationSourceDocument(sourceIndex, "shared.ts", { readFile: async () => shared }),
    ).resolves.toMatchObject({ text: shared, complete: true });
    await expect(
      readApplicationSourceDocument(sourceIndex, "shared.ts", {
        readFile: () => `${shared}changed`,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    await expect(
      readApplicationSourceDocument(sourceIndex, "shared.ts", {
        readFile: () => shared,
        maxBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_TOO_LARGE" });
    expect(ApplicationSourceReadError).toBeDefined();

    const aborted = new AbortController();
    aborted.abort("stop");
    expect(() =>
      indexApplicationSources({
        manifest,
        program: programFor(files),
        projectRoot: "/project",
        signal: aborted.signal,
      }),
    ).toThrow(AnalysisAbortedError);
  });

  test("enforces every source discovery and retention limit on retained resources", () => {
    const manifest = manifestFor({
      concepts: [{ name: "Logical", constructorName: "LogicalConcept" }],
      reactions: ["React"],
    });
    const files = {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction } from "@mit-sdg/sync-engine/language";
class LogicalConcept { run() {} _read() {} }
const words = vocabulary({ concepts: { Logical: LogicalConcept }, computations: {} });
const React = reaction(() => null);
assemble({ vocabulary: words, composition: { React } });
`,
    };
    const baseline = index(manifest, files);
    for (const [limit, maximum] of [
      ["maxSourceDocuments", baseline.resourceUsage.sourceDocuments - 1],
      ["maxSourceAnchors", baseline.resourceUsage.sourceAnchors - 1],
      ["maxAstCandidates", baseline.resourceUsage.astNodes - 1],
      ["maxAstNodes", baseline.resourceUsage.astNodes - 1],
    ] as const) {
      let caught: unknown;
      try {
        index(manifest, files, { limits: { [limit]: maximum } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AnalysisLimitError);
      expect(caught).toMatchObject({ limit, maximum });
    }
  });

  test("uses static depth and alternative limits to stop genuine source resolution", () => {
    const depthManifest = manifestFor({ concepts: [] });
    const depthFiles = {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const words = vocabulary({ concepts: {}, computations: {} });
const one = words;
const two = one;
const three = two;
assemble({ vocabulary: three, composition: {} });
`,
    };
    expect(index(depthManifest, depthFiles).issues).not.toContainEqual(
      expect.objectContaining({ code: "UNRESOLVED_CONCEPT_SET_SOURCE" }),
    );
    expect(
      index(depthManifest, depthFiles, { limits: { maxStaticResolutionDepth: 1 } }).issues,
    ).toContainEqual(expect.objectContaining({ code: "UNRESOLVED_CONCEPT_SET_SOURCE" }));

    const alternativesManifest = manifestFor({ concepts: [], computations: ["selected"] });
    const alternativesFiles = {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const words = vocabulary({
  concepts: {},
  computations: { selected: () => 1, extraA: () => 2, extraB: () => 3 },
});
assemble({ vocabulary: words, composition: {} });
`,
    };
    expect(
      sourcesFor(index(alternativesManifest, alternativesFiles), {
        kind: "computation",
        computation: "selected",
      }),
    ).not.toEqual([]);
    expect(
      index(alternativesManifest, alternativesFiles, {
        limits: { maxStaticResolutionAlternatives: 2 },
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: "UNRESOLVED_COMPUTATION_SOURCE" }));
  });

  test("strictly validates attribution roots and supports path, export, and offset selection", () => {
    const manifest = manifestFor({ concepts: [], reactions: ["React"] });
    const source = `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction } from "@mit-sdg/sync-engine/language";
const words = vocabulary({ concepts: {}, computations: {} });
export const React = reaction(() => null);
export const application = assemble({ vocabulary: words, composition: { React } });
`;
    const files = { "app.ts": source };
    const invalidRoots: readonly [string, readonly SourceAttributionRoot[]][] = [
      ["escaping path", [{ path: "../app.ts" }]],
      ["empty export", [{ path: "app.ts", exportName: "" }]],
      ["negative offset", [{ path: "app.ts", offset: -1 }]],
      ["two selectors", [{ path: "app.ts", exportName: "application", offset: 0 }]],
    ];
    for (const [label, sourceRoots] of invalidRoots) {
      expect(() => index(manifest, files, { sourceRoots }), label).toThrow(TypeError);
    }

    for (const sourceRoots of [
      [{ path: "app.ts" }],
      [{ path: "app.ts", exportName: "application" }],
      [{ path: "app.ts", offset: source.indexOf("assemble({") }],
    ] as const) {
      expect(index(manifest, files, { sourceRoots }).issues).not.toContainEqual(
        expect.objectContaining({ code: "UNRESOLVED_ASSEMBLY_SOURCE" }),
      );
    }
    for (const sourceRoots of [
      [],
      [{ path: "missing.ts" }],
      [{ path: "app.ts", exportName: "missing" }],
      [{ path: "app.ts", offset: source.length + 1 }],
    ] as const) {
      expect(index(manifest, files, { sourceRoots }).issues).toContainEqual(
        expect.objectContaining({ code: "UNRESOLVED_ASSEMBLY_SOURCE" }),
      );
    }
  }, 20_000);

  test("reports registrations without declarations and missing canonical members", () => {
    const manifest = manifestFor({
      concepts: [{ name: "Logical", constructorName: "LogicalCanonical" }],
    });
    const missingRegistration = index(manifest, {
      "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
const registration = registerConcept();
const set = conceptSet({ Logical: registration });
assemble({ conceptSet: set, composition: {} });
`,
    });
    expect(missingRegistration.issues).toContainEqual(
      expect.objectContaining({
        code: "MISSING_CONCEPT_REGISTRATION",
        ref: { kind: "concept", concept: "Logical" },
        role: "registration",
      }),
    );

    const missingMembers = index(manifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
class LogicalCanonical {}
const words = vocabulary({ concepts: { Logical: LogicalCanonical }, computations: {} });
assemble({ vocabulary: words, composition: {} });
`,
    });
    for (const ref of [
      { kind: "action", concept: "Logical", action: "run" },
      { kind: "query", concept: "Logical", query: "_read" },
    ] as const) {
      expect(missingMembers.issues).toContainEqual(
        expect.objectContaining({
          code: "UNRESOLVED_DESIGN_SOURCE",
          ref,
          role: "canonical-contract",
        }),
      );
    }
  });

  test("resolves destructured implementation factories and rejects control-flow returns", () => {
    const manifest = manifestFor({
      concepts: [
        {
          name: "ObjectFactory",
          constructorName: "ObjectCanonical",
          selected: { via: "instances", constructorName: "ObjectSelected" },
        },
        {
          name: "DefaultFactory",
          constructorName: "DefaultCanonical",
          selected: { via: "instances", constructorName: "DefaultSelected" },
        },
        {
          name: "ConditionalFactory",
          constructorName: "ConditionalCanonical",
          selected: { via: "instances", constructorName: "ConditionalSelected" },
        },
        {
          name: "MultipleFactory",
          constructorName: "MultipleCanonical",
          selected: { via: "instances", constructorName: "MultipleSelected" },
        },
        {
          name: "EmptyFactory",
          constructorName: "EmptyCanonical",
          selected: { via: "instances", constructorName: "EmptySelected" },
        },
      ],
    });
    const sourceIndex = index(manifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
class ObjectCanonical { run() {} _read() {} }
class DefaultCanonical { run() {} _read() {} }
class ConditionalCanonical { run() {} _read() {} }
class MultipleCanonical { run() {} _read() {} }
class EmptyCanonical { run() {} _read() {} }
class ObjectSelected extends ObjectCanonical { run() { return "object"; } }
class DefaultSelected extends DefaultCanonical { run() { return "default"; } }
class ConditionalSelected extends ConditionalCanonical { run() { return "conditional"; } }
class MultipleSelected extends MultipleCanonical { run() { return "multiple"; } }
class EmptySelected extends EmptyCanonical { run() { return "empty"; } }
function fromObject({ implementation }: { implementation: ObjectSelected }) {
  return implementation;
}
function fromDefault(
  { implementation }: { implementation: DefaultSelected } = {
    implementation: new DefaultSelected(),
  },
) {
  return implementation;
}
declare const choose: boolean;
function conditionalFactory() {
  if (choose) return new ConditionalSelected();
}
function multipleFactory() {
  if (choose) return new MultipleSelected();
  return new MultipleSelected();
}
function emptyFactory() {}
const words = vocabulary({
  concepts: {
    ObjectFactory: ObjectCanonical,
    DefaultFactory: DefaultCanonical,
    ConditionalFactory: ConditionalCanonical,
    MultipleFactory: MultipleCanonical,
    EmptyFactory: EmptyCanonical,
  },
  computations: {},
});
assemble({
  vocabulary: words,
  instances: {
    ObjectFactory: fromObject({ implementation: new ObjectSelected() }),
    DefaultFactory: fromDefault(),
    ConditionalFactory: conditionalFactory(),
    MultipleFactory: multipleFactory(),
    EmptyFactory: emptyFactory(),
  },
  composition: {},
});
`,
    });

    for (const concept of ["ObjectFactory", "DefaultFactory"]) {
      expect(
        sourcesFor(sourceIndex, { kind: "action", concept, action: "run" }).find(
          ({ role }) => role === "selected-implementation",
        )?.range.path,
      ).toBe("app.ts");
      expect(sourceIndex.issues).not.toContainEqual(
        expect.objectContaining({
          code: "UNRESOLVED_IMPLEMENTATION_SELECTION",
          ref: { kind: "concept", concept },
        }),
      );
    }
    for (const concept of ["ConditionalFactory", "MultipleFactory", "EmptyFactory"]) {
      expect(sourceIndex.issues).toContainEqual(
        expect.objectContaining({
          code: "UNRESOLVED_IMPLEMENTATION_SELECTION",
          ref: { kind: "concept", concept },
        }),
      );
    }
  });

  test("classifies every source overlap and validates public query bounds", () => {
    const manifest = manifestFor({ concepts: [], reactions: ["React"] });
    const sourceIndex = index(manifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction } from "@mit-sdg/sync-engine/language";
const words = vocabulary({ concepts: {}, computations: {} });
const React = reaction(() => null);
assemble({ vocabulary: words, composition: { React } });
`,
    });
    const reaction = sourceIndex.entries.find(
      ({ ref }) => ref.kind === "reaction" && ref.reaction === "React",
    )!;
    const original = reaction.sources[0]!;
    const { focusRange: _focusRange, ...anchor } = original;
    const withoutFocus: ApplicationSourceIndex = {
      ...sourceIndex,
      entries: sourceIndex.entries.map((entry) =>
        entry === reaction ? { ...entry, sources: [anchor] } : entry,
      ),
    };
    const { start, end, path } = anchor.range;
    const specificity = (rangeStart: number, rangeEnd: number) =>
      queryApplicationSources(withoutFocus, {
        kind: "range",
        path,
        start: rangeStart,
        end: rangeEnd,
      }).matches.find(({ ref }) => ref.kind === "reaction")?.specificity;

    expect(specificity(start.offset, end.offset)).toBe("exact-semantic-range");
    expect(specificity(start.offset + 1, end.offset - 1)).toBe("query-contained-by-anchor");
    expect(specificity(start.offset - 1, end.offset + 1)).toBe("anchor-contained-by-query");
    expect(specificity(start.offset - 1, start.offset + 1)).toBe("partial-overlap");
    expect(
      queryApplicationSources(withoutFocus, { kind: "cursor", path, offset: end.offset }).matches,
    ).toEqual([]);
    expect(
      queryApplicationSources(withoutFocus, { kind: "file", path }).matches.some(
        ({ specificity: value }) => value === "whole-file",
      ),
    ).toBe(true);
    expect(
      queryApplicationSources(withoutFocus, { kind: "file", path: "other.ts" }).matches,
    ).toEqual([]);

    const withCandidateIssue: ApplicationSourceIndex = {
      ...withoutFocus,
      issues: [
        {
          code: "AMBIGUOUS_DESIGN_SOURCE",
          severity: "warning",
          message: "controlled candidate ambiguity",
          candidates: [anchor.range],
        },
      ],
      resourceUsage: { ...withoutFocus.resourceUsage, diagnostics: 1 },
    };
    expect(
      queryApplicationSources(withCandidateIssue, {
        kind: "range",
        path,
        start: start.offset,
        end: end.offset,
      }),
    ).toMatchObject({ complete: false, issues: [{ code: "AMBIGUOUS_DESIGN_SOURCE" }] });

    expect(designRefsForSourceRange(withoutFocus, { path })).toContainEqual({
      kind: "reaction",
      reaction: "React",
    });
    expect(
      designRefsForSourceRange(withoutFocus, { path, startOffset: start.offset }),
    ).toContainEqual({ kind: "reaction", reaction: "React" });
    expect(designRefsForSourceRange(withoutFocus, { path, endOffset: end.offset })).toContainEqual({
      kind: "reaction",
      reaction: "React",
    });

    const invalidQueries: readonly [string, () => unknown][] = [
      ["non-object query", () => queryApplicationSources(sourceIndex, null as never)],
      [
        "invalid query path",
        () => queryApplicationSources(sourceIndex, { kind: "file", path: "../app.ts" }),
      ],
      [
        "unknown query discriminant",
        () =>
          queryApplicationSources(sourceIndex, {
            kind: "unknown",
            path: "app.ts",
          } as never),
      ],
      [
        "malformed ref",
        () =>
          queryApplicationSources(sourceIndex, {
            kind: "ref",
            ref: { kind: "reaction", reaction: "React", extra: true },
          } as never),
      ],
      [
        "unknown ref discriminant",
        () =>
          queryApplicationSources(sourceIndex, {
            kind: "ref",
            ref: { kind: "unknown", reaction: "React" },
          } as never),
      ],
      [
        "negative cursor",
        () => queryApplicationSources(sourceIndex, { kind: "cursor", path: "app.ts", offset: -1 }),
      ],
      [
        "negative range start",
        () =>
          queryApplicationSources(sourceIndex, {
            kind: "range",
            path: "app.ts",
            start: -1,
            end: 0,
          }),
      ],
      [
        "reversed range",
        () =>
          queryApplicationSources(sourceIndex, {
            kind: "range",
            path: "app.ts",
            start: 2,
            end: 1,
          }),
      ],
      [
        "invalid match mode",
        () =>
          queryApplicationSources(
            sourceIndex,
            { kind: "file", path: "app.ts" },
            {
              match: "first" as never,
            },
          ),
      ],
      [
        "invalid role",
        () =>
          queryApplicationSources(
            sourceIndex,
            { kind: "file", path: "app.ts" },
            {
              roles: ["unknown" as never],
            },
          ),
      ],
      [
        "invalid resolution",
        () =>
          queryApplicationSources(
            sourceIndex,
            { kind: "file", path: "app.ts" },
            {
              resolutions: ["unknown" as never],
            },
          ),
      ],
      [
        "reversed design range",
        () =>
          designRefsForSourceRange(sourceIndex, { path: "app.ts", startOffset: 2, endOffset: 1 }),
      ],
    ];
    for (const [label, query] of invalidQueries) expect(query, label).toThrow(TypeError);
  });

  test("emits source-discovery issue codes from controlled source shapes", () => {
    interface IssueFixture {
      readonly manifest: ManifestOptions;
      readonly files: Readonly<Record<string, string>>;
      readonly readFile?: (path: string) => string | undefined;
    }
    const registeredSpecification = (specifier: string): string =>
      `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from ${JSON.stringify(specifier)};
class LogicalCanonical { run() {} _read() {} }
const logical = registerConcept({ class: LogicalCanonical, spec });
const set = conceptSet({ Logical: logical });
assemble({ conceptSet: set, composition: {} });
`;
    const scenarios = {
      AMBIGUOUS_DESIGN_SOURCE: {
        manifest: { concepts: [], views: ["shared"] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { view } from "@mit-sdg/sync-engine/language";
const words = vocabulary({ concepts: {}, computations: {} });
const First = view("shared", () => null);
const Second = view("shared", () => null);
assemble({ vocabulary: words, composition: { First, Second } });
`,
        },
      },
      UNRESOLVED_DESIGN_SOURCE: {
        manifest: { concepts: [], reactions: ["Missing"] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const words = vocabulary({ concepts: {}, computations: {} });
assemble({ vocabulary: words, composition: {} });
`,
        },
      },
      MISSING_CONCEPT_REGISTRATION: {
        manifest: { concepts: [{ name: "Logical" }] },
        files: {
          "app.ts": `import { assemble, conceptSet } from "@mit-sdg/sync-engine/assembly";
declare const dynamicRegistration: unknown;
const set = conceptSet({ Logical: dynamicRegistration });
assemble({ conceptSet: set, composition: {} });
`,
        },
      },
      AMBIGUOUS_CONCEPT_REGISTRATION: {
        manifest: { concepts: [{ name: "Logical" }] },
        files: {
          "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
class One { run() {} _read() {} }
class Two { run() {} _read() {} }
const one = registerConcept({ class: One, spec: "# one" });
const two = registerConcept({ class: Two, spec: "# two" });
declare const choose: boolean;
const set = conceptSet({ Logical: choose ? one : two });
assemble({ conceptSet: set, composition: {} });
`,
        },
      },
      UNRESOLVED_CONCEPT_SET_SOURCE: {
        manifest: { concepts: [] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
declare const dynamicVocabulary: unknown;
assemble({ vocabulary: dynamicVocabulary, composition: {} });
`,
        },
      },
      AMBIGUOUS_CONCEPT_SET_SOURCE: {
        manifest: { concepts: [] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const first = vocabulary({ concepts: {}, computations: {} });
const second = vocabulary({ concepts: {}, computations: {} });
declare const choose: boolean;
assemble({ vocabulary: choose ? first : second, composition: {} });
`,
        },
      },
      AMBIGUOUS_ASSEMBLY_SOURCE: {
        manifest: { concepts: [] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
assemble({ vocabulary: {}, composition: {} });
assemble({ vocabulary: {}, composition: {} });
`,
        },
      },
      UNRESOLVED_ASSEMBLY_SOURCE: {
        manifest: { concepts: [] },
        files: { "app.ts": "export {};\n" },
      },
      UNRESOLVED_IMPLEMENTATION_SELECTION: {
        manifest: {
          concepts: [
            {
              name: "Logical",
              constructorName: "LogicalCanonical",
              selected: { via: "instances", constructorName: "Selected" },
            },
          ],
        },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
class LogicalCanonical { run() {} _read() {} }
class Selected extends LogicalCanonical {}
declare const dynamic: Record<string, object>;
const words = vocabulary({ concepts: { Logical: LogicalCanonical }, computations: {} });
assemble({ vocabulary: words, instances: { Logical: new Selected(), ...dynamic }, composition: {} });
`,
        },
      },
      AMBIGUOUS_ENDPOINT_SOURCE: {
        manifest: {
          concepts: [],
          reactions: ["Route"],
          endpoints: [{ name: "Route", path: "/route", reactions: ["Route"] }],
        },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint } from "@mit-sdg/sync-engine/boundary";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
declare const dynamic: Record<string, unknown>;
const words = vocabulary({ concepts: {}, computations: {} });
const Route = endpoint("/route", () => null);
assemble({ vocabulary: words, composition: { Route, ...dynamic } });
`,
        },
      },
      UNRESOLVED_COMPUTATION_SOURCE: {
        manifest: { concepts: [], computations: ["custom"] },
        files: {
          "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const words = vocabulary({ concepts: {}, computations: {} });
assemble({ vocabulary: words, composition: {} });
`,
        },
      },
      SOURCE_OUTSIDE_PROJECT: {
        manifest: { concepts: [{ name: "Logical", constructorName: "LogicalCanonical" }] },
        files: { "app.ts": registeredSpecification("../outside/logical.md") },
      },
      SPECIFICATION_UNREADABLE: {
        manifest: { concepts: [{ name: "Logical", constructorName: "LogicalCanonical" }] },
        files: { "app.ts": registeredSpecification("./logical.md") },
        readFile: () => undefined,
      },
      SPECIFICATION_MISMATCH: {
        manifest: { concepts: [{ name: "Logical", constructorName: "LogicalCanonical" }] },
        files: { "app.ts": registeredSpecification("./logical.md") },
        readFile: (path) => (path === resolve("/project/logical.md") ? "# Logical\n" : undefined),
      },
    } satisfies Partial<Record<SourceIndexIssueCode, IssueFixture>>;

    for (const [code, scenario] of Object.entries(scenarios).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const selected: IssueFixture = scenario;
      const sourceIndex = index(
        manifestFor(selected.manifest),
        selected.files,
        selected.readFile === undefined ? {} : { readFile: selected.readFile },
      );
      expect(sourceIndex.issues, code).toContainEqual(
        expect.objectContaining({ code, severity: "warning" }),
      );
    }
  }, 30_000);

  test("reports dynamic, unreadable, and mismatched specifications and missing computations", () => {
    const registered = (specifier: string): string =>
      `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from ${JSON.stringify(specifier)};
class LogicalCanonical { choose() {} _read() {} }
const logical = registerConcept({ class: LogicalCanonical, spec });
const set = conceptSet({ Logical: logical });
assemble({ conceptSet: set, composition: {} });
`;
    const dynamicManifest = manifestFor({
      concepts: [{ name: "Logical", constructorName: "LogicalCanonical" }],
    });
    const dynamic = index(dynamicManifest, {
      "app.ts": `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
class LogicalCanonical { run() {} _read() {} }
declare const dynamicSpec: unknown;
const logical = registerConcept({ class: LogicalCanonical, spec: dynamicSpec });
const set = conceptSet({ Logical: logical });
assemble({ conceptSet: set, composition: {} });
`,
    });
    expect(dynamic.issues).toContainEqual(
      expect.objectContaining({
        code: "SPECIFICATION_UNREADABLE",
        ref: { kind: "concept", concept: "Logical" },
      }),
    );

    const throwingRead = index(
      dynamicManifest,
      { "app.ts": registered("./logical.md") },
      {
        readFile: () => {
          throw new Error("controlled specification read failure");
        },
      },
    );
    expect(throwingRead.issues).toContainEqual(
      expect.objectContaining({ code: "SPECIFICATION_UNREADABLE" }),
    );

    const expectedSpecification = `# Logical

## Purpose

Keep a logical value.

## Principle

Choosing replaces it.

## Types

\`\`\`types
external Text
\`\`\`

## State

\`\`\`state
one logical Text
\`\`\`

## Actions

\`\`\`actions
choose(value: Text) : return (value: Text)
  where true
  then
    replace the logical value
    return value
\`\`\`

## Queries

\`\`\`queries
_read() : optional (value: Text)
\`\`\`
`;
    const actualSpecification = expectedSpecification.replace(
      "Keep a logical value.",
      "Keep a different logical value.",
    );
    const mismatchManifest = manifestFor({
      concepts: [
        {
          name: "Logical",
          constructorName: "LogicalCanonical",
          actions: ["choose"],
          queries: ["_read"],
          specification: parseConceptSpecification(expectedSpecification),
        },
      ],
    });
    const mismatch = index(
      mismatchManifest,
      { "app.ts": registered("./logical.md") },
      {
        readFile: (path) =>
          path === resolve("/project/logical.md") ? actualSpecification : undefined,
      },
    );
    expect(mismatch.issues).toContainEqual(
      expect.objectContaining({ code: "SPECIFICATION_MISMATCH" }),
    );

    const computationManifest = manifestFor({ concepts: [], computations: ["custom"] });
    const missingComputation = index(computationManifest, {
      "app.ts": `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
const words = vocabulary();
assemble({ vocabulary: words, composition: {} });
`,
    });
    expect(missingComputation.issues).toContainEqual(
      expect.objectContaining({
        code: "UNRESOLVED_COMPUTATION_SOURCE",
        ref: { kind: "computation", computation: "custom" },
      }),
    );
  }, 15_000);

  test("reports every public source document read failure without filesystem permissions", async () => {
    const manifest = manifestFor({ concepts: [] });
    const text = `import { assemble } from "@mit-sdg/sync-engine/assembly";
assemble({ vocabulary: {}, composition: {} });
`;
    const sourceIndex = index(manifest, { "app.ts": text });
    const document = sourceIndex.documents.find(({ path }) => path === "app.ts")!;
    const preAbort = new AbortController();
    preAbort.abort("before read");
    const postAbort = new AbortController();
    const changed = `${text.startsWith("i") ? "I" : "i"}${text.slice(1)}`;
    const failures: readonly [
      string,
      "ABORTED" | "SOURCE_NOT_FOUND" | "SOURCE_UNREADABLE" | "SOURCE_TOO_LARGE" | "SOURCE_CHANGED",
      () => Promise<unknown>,
    ][] = [
      [
        "pre-aborted",
        "ABORTED",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => text,
            signal: preAbort.signal,
          }),
      ],
      [
        "aborted after read",
        "ABORTED",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => {
              postAbort.abort("after read");
              return text;
            },
            signal: postAbort.signal,
          }),
      ],
      [
        "unindexed",
        "SOURCE_NOT_FOUND",
        () =>
          readApplicationSourceDocument(sourceIndex, "missing.ts", { readFile: () => undefined }),
      ],
      [
        "removed after indexing",
        "SOURCE_NOT_FOUND",
        () => readApplicationSourceDocument(sourceIndex, "app.ts", { readFile: () => undefined }),
      ],
      [
        "reader throws",
        "SOURCE_UNREADABLE",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => {
              throw new Error("controlled read failure");
            },
          }),
      ],
      [
        "reader throws a non-error",
        "SOURCE_UNREADABLE",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => {
              throw "controlled non-error read failure";
            },
          }),
      ],
      [
        "reader returns non-text",
        "SOURCE_UNREADABLE",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: (() => 42) as never,
          }),
      ],
      [
        "indexed metadata is over bound",
        "SOURCE_TOO_LARGE",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => text,
            maxBytes: document.byteLength - 1,
          }),
      ],
      [
        "returned text is over bound",
        "SOURCE_TOO_LARGE",
        () =>
          readApplicationSourceDocument(sourceIndex, "app.ts", {
            readFile: () => `${text}x`,
            maxBytes: document.byteLength,
          }),
      ],
      [
        "same-length content changed",
        "SOURCE_CHANGED",
        () => readApplicationSourceDocument(sourceIndex, "app.ts", { readFile: () => changed }),
      ],
    ];

    for (const [label, code, read] of failures) {
      let caught: unknown;
      try {
        await read();
      } catch (error) {
        caught = error;
      }
      expect(caught, label).toBeInstanceOf(ApplicationSourceReadError);
      expect(caught, label).toMatchObject({ code });
    }
    await expect(
      readApplicationSourceDocument(sourceIndex, "app.ts", null as never),
    ).rejects.toThrow(TypeError);
    await expect(
      readApplicationSourceDocument(sourceIndex, "app.ts", {
        readFile: () => text,
        maxBytes: -1,
      }),
    ).rejects.toThrow(TypeError);
  });
});
