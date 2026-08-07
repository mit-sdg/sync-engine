import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  AnalysisError,
  AnalysisLimitError,
  applicationProjectAnalysisDigest,
  loadApplicationProject,
  parseApplicationProjectAnalysis,
  renderApplicationProjectAnalysis,
  validateApplicationProjectAnalysis,
  type ApplicationProjectAnalysis,
  type SourceAnchor,
} from "@mit-sdg/sync-engine-analysis/tooling";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  applicationProjectFixture,
  fixtureOptions,
  linkOutsideDirectory,
  type ApplicationProjectFixture,
} from "./application-project-fixture.ts";

const fixtures: ApplicationProjectFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function fixture(): ApplicationProjectFixture {
  const value = applicationProjectFixture();
  fixtures.push(value);
  return value;
}

function analysis(): ApplicationProjectAnalysis {
  const value = fixture();
  return loadApplicationProject(fixtureOptions(value));
}

function rewriteConfig(path: string, update: (config: Record<string, unknown>) => void): void {
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  update(config);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function expectInvalid(value: unknown): void {
  expect(() => validateApplicationProjectAnalysis(value)).toThrow(AnalysisError);
}

function firstAnchor(value: ApplicationProjectAnalysis): SourceAnchor {
  const anchor = value.sourceIndex.entries.flatMap(({ sources }) => sources)[0];
  if (anchor === undefined) throw new Error("fixture produced no source anchor");
  return anchor;
}

describe("application project format", () => {
  test("loads solution roots and transitive source projects without declarations", () => {
    const project = analysis();

    expect(project.provenance.tsconfigPath).toBe("tsconfig.json");
    expect(project.provenance.projectReferences).toEqual([
      "app/tsconfig.json",
      "domain/tsconfig.json",
    ]);
    expect(project.provenance.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "tsconfig.json",
        "app/tsconfig.json",
        "app/src/app.ts",
        "domain/tsconfig.json",
        "domain/src/index.ts",
        "domain/src/notes.ts",
      ]),
    );
    expect(project.provenance.files.some(({ path }) => path.includes("/dist/"))).toBe(false);
    expect(project.sourceIndex.documents.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["app/src/app.ts", "domain/src/index.ts", "domain/src/notes.ts"]),
    );
    const action = project.sourceIndex.entries.find(
      ({ ref }) => ref.kind === "action" && ref.concept === "Notes" && ref.action === "add",
    );
    expect(action?.sources).toContainEqual(
      expect.objectContaining({ range: expect.objectContaining({ path: "domain/src/notes.ts" }) }),
    );
    expect(project.diagnostics).toContainEqual(
      expect.objectContaining({
        phase: "semantic",
        code: 2322,
        path: "domain/src/diagnostic.ts",
        projectConfigPath: "domain/tsconfig.json",
      }),
    );
  });

  test("serializes config, global, and syntactic TypeScript diagnostics", () => {
    const projectFixture = fixture();
    rewriteConfig(join(projectFixture.root, "domain/tsconfig.json"), (config) => {
      const compilerOptions = config.compilerOptions as Record<string, unknown>;
      compilerOptions.noLib = true;
      compilerOptions.unknownCompilerOption = true;
    });
    writeFileSync(
      join(projectFixture.root, "domain/src/diagnostic.ts"),
      "export const broken = ;\n",
    );

    const project = loadApplicationProject(fixtureOptions(projectFixture));
    expect(project.diagnostics.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining(["config", "global", "syntactic"]),
    );
    expect(
      project.diagnostics.some(({ phase, path }) => phase === "global" && path === undefined),
    ).toBe(true);
  });

  test("rejects empty project options and non-function readers", () => {
    const projectFixture = fixture();
    const options = fixtureOptions(projectFixture);
    expect(() => loadApplicationProject({ ...options, sourceRevision: "" })).toThrow(
      /sourceRevision must be a non-empty string/,
    );
    expect(() => loadApplicationProject({ ...options, readFile: 1 as never })).toThrow(
      /readFile must be a function/,
    );
  });

  test("strictly round-trips, digests, and rejects nested tampering", () => {
    const project = analysis();
    const rendered = renderApplicationProjectAnalysis(project);
    const parsed = parseApplicationProjectAnalysis(rendered);
    expect(parsed).toEqual(project);
    expect(applicationProjectAnalysisDigest(parsed)).toBe(
      applicationProjectAnalysisDigest(project),
    );
    expect(() => validateApplicationProjectAnalysis(parsed)).not.toThrow();
    expect(() => parseApplicationProjectAnalysis("{")).toThrow(AnalysisError);

    const withExcerpt = structuredClone(project);
    const anchor = firstAnchor(withExcerpt);
    const start = anchor.range.start;
    (anchor as { excerpt?: unknown }).excerpt = {
      range: {
        path: anchor.range.path,
        start,
        end: { offset: start.offset + 1, line: start.line, column: start.column + 1 },
      },
      text: anchor.text.slice(0, 1),
      complete: false,
    };
    expect(() => validateApplicationProjectAnalysis(withExcerpt)).not.toThrow();

    const mutations: Array<[string, (value: ApplicationProjectAnalysis) => void]> = [
      ["format", (value) => ((value as { format: string }).format = "stale")],
      ["version", (value) => ((value as { version: number }).version = 1)],
      [
        "analyzer",
        (value) => ((value.provenance.analyzer as { version: string }).version = "stale"),
      ],
      [
        "manifest digest",
        (value) =>
          ((value.provenance.manifest as { digest: string }).digest = "fnv1a64-0000000000000000"),
      ],
      [
        "revision",
        (value) => ((value.provenance as { sourceRevision: string }).sourceRevision = "other"),
      ],
      [
        "source digest",
        (value) => ((value.provenance as { sourceDigest: string }).sourceDigest = "0".repeat(64)),
      ],
      ["reference order", (value) => (value.provenance.projectReferences as string[]).reverse()],
      [
        "duplicate reference",
        (value) =>
          (value.provenance.projectReferences as string[]).push(
            value.provenance.projectReferences[0],
          ),
      ],
      ["file order", (value) => (value.provenance.files as unknown as unknown[]).reverse()],
      [
        "duplicate file",
        (value) =>
          (value.provenance.files as unknown as unknown[]).push(
            structuredClone(value.provenance.files[0]),
          ),
      ],
      ["index version", (value) => ((value.applicationIndex as { version: number }).version = 1)],
      [
        "index provenance",
        (value) =>
          ((value.applicationIndex.provenance.manifest as { digest: string }).digest =
            "fnv1a64-0000000000000000"),
      ],
      [
        "index order",
        (value) => (value.applicationIndex.inventory as unknown as unknown[]).reverse(),
      ],
      [
        "index resource usage",
        (value) =>
          ((value.applicationIndex.resourceUsage as { graphNodes: number }).graphNodes += 1),
      ],
      ["source version", (value) => ((value.sourceIndex as { version: number }).version = 1)],
      [
        "source provenance",
        (value) =>
          ((value.sourceIndex.provenance.analyzer as { version: string }).version = "stale"),
      ],
      [
        "TypeScript mismatch",
        (value) =>
          ((value.sourceIndex as { typescriptVersion: string }).typescriptVersion = "0.0.0"),
      ],
      [
        "document digest",
        (value) => ((value.sourceIndex.documents[0] as { digest: string }).digest = "0".repeat(64)),
      ],
      [
        "document order",
        (value) => (value.sourceIndex.documents as unknown as unknown[]).reverse(),
      ],
      [
        "source entry duplicate",
        (value) =>
          (value.sourceIndex.entries as unknown as unknown[]).push(
            structuredClone(value.sourceIndex.entries[0]),
          ),
      ],
      [
        "source resource usage",
        (value) =>
          ((value.sourceIndex.resourceUsage as { sourceDocuments: number }).sourceDocuments += 1),
      ],
      ["anchor text", (value) => ((firstAnchor(value) as { text: string }).text += "x")],
      [
        "anchor digest",
        (value) => ((firstAnchor(value) as { digest: string }).digest = "0".repeat(64)),
      ],
      [
        "anchor range",
        (value) => ((firstAnchor(value).range.end as { offset: number }).offset += 1),
      ],
      [
        "focus range",
        (value) => {
          const selected = firstAnchor(value);
          (selected as { focusRange?: unknown }).focusRange = {
            path: selected.range.path,
            start: selected.range.start,
            end: { ...selected.range.end, offset: selected.range.end.offset + 1 },
          };
        },
      ],
      [
        "diagnostic duplicate",
        (value) =>
          (value.diagnostics as unknown as unknown[]).push(structuredClone(value.diagnostics[0])),
      ],
      [
        "diagnostic project",
        (value) =>
          ((value.diagnostics[0] as { projectConfigPath: string }).projectConfigPath =
            "unknown/tsconfig.json"),
      ],
      [
        "issue fields",
        (value) => {
          const issue = value.sourceIndex.issues[0] as unknown as Record<string, unknown>;
          issue.stale = true;
        },
      ],
      [
        "resource usage",
        (value) => ((value.resourceUsage as { graphNodes: number }).graphNodes += 1),
      ],
    ];
    for (const [label, mutate] of mutations) {
      const tampered = structuredClone(project);
      mutate(tampered);
      expectInvalid(tampered);
      expect(() => applicationProjectAnalysisDigest(tampered), label).toThrow(AnalysisError);
    }

    const badExcerpt = structuredClone(withExcerpt);
    (firstAnchor(badExcerpt).excerpt as { text: string }).text = "tampered";
    expectInvalid(badExcerpt);
  });

  test("rejects non-JSON persistence shapes and malformed scalar contracts", () => {
    const project = analysis();
    expect(() => parseApplicationProjectAnalysis(null as never)).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const symbolObject: Record<PropertyKey, unknown> = { value: true };
    symbolObject[Symbol("hidden")] = true;
    const accessorObject: Record<string, unknown> = {};
    Object.defineProperty(accessorObject, "value", {
      enumerable: true,
      get: () => true,
    });
    const sparse = structuredClone(project);
    const sparseDiagnostics: unknown[] = [];
    sparseDiagnostics.length = 1;
    (sparse as unknown as { diagnostics: unknown[] }).diagnostics = sparseDiagnostics;
    const decoratedArray = structuredClone(project);
    Object.defineProperty(decoratedArray.diagnostics, "extra", {
      enumerable: true,
      value: true,
    });
    const nonJsonValues: readonly [string, unknown][] = [
      ["undefined", undefined],
      ["function", () => undefined],
      ["cycle", cycle],
      ["non-plain object", new Date(0)],
      ["symbol field", symbolObject],
      ["accessor field", accessorObject],
      ["sparse array", sparse],
      ["decorated array", decoratedArray],
    ];
    for (const [label, value] of nonJsonValues) {
      expect(() => validateApplicationProjectAnalysis(value), label).toThrow(AnalysisError);
    }

    const mutations: readonly [string, (value: ApplicationProjectAnalysis) => void][] = [
      [
        "manifest digest syntax",
        (value) => ((value as { manifestDigest: string }).manifestDigest = "bad"),
      ],
      [
        "file digest syntax",
        (value) => ((value.provenance.files[0] as { digest: string }).digest = "A".repeat(64)),
      ],
      [
        "negative usage",
        (value) => ((value.resourceUsage as { projectBytes: number }).projectBytes = -1),
      ],
      [
        "unknown impact relation",
        (value) => ((value.applicationIndex.edges[0] as { relation: string }).relation = "unknown"),
      ],
      [
        "edge to unknown node",
        (value) =>
          ((value.applicationIndex.edges[0] as { from: unknown }).from = {
            kind: "reaction",
            reaction: "missing",
          }),
      ],
      [
        "referenced-only overlap",
        (value) =>
          (value.applicationIndex.referencedOnly as unknown[]).push(
            structuredClone(value.applicationIndex.inventory[0]),
          ),
      ],
      ["stale node union", (value) => (value.applicationIndex.nodes as unknown[]).pop()],
      [
        "duplicate issue suggestions",
        (value) => {
          const suggestion = structuredClone(value.applicationIndex.inventory[0]);
          (value.applicationIndex.issues as unknown[]).push({
            code: "UNKNOWN_SEED",
            severity: "error",
            message: "controlled invalid suggestions",
            suggestions: [suggestion, suggestion],
          });
        },
      ],
      [
        "root repeated as reference",
        (value) =>
          (value.provenance.projectReferences as string[]).push(value.provenance.tsconfigPath),
      ],
      [
        "config omitted from files",
        (value) => {
          const position = value.provenance.files.findIndex(
            ({ path }) => path === value.provenance.tsconfigPath,
          );
          (value.provenance.files as unknown[]).splice(position, 1);
        },
      ],
    ];
    for (const [label, mutate] of mutations) {
      const malformed = structuredClone(project);
      mutate(malformed);
      expect(() => validateApplicationProjectAnalysis(malformed), label).toThrow(AnalysisError);
    }

    for (const path of [
      "/absolute.ts",
      "back\\slash.ts",
      "trailing/",
      "a//b.ts",
      "a/./b.ts",
      "a/../b.ts",
    ]) {
      const malformed = structuredClone(project);
      (malformed.provenance.files[0] as { path: string }).path = path;
      expect(() => validateApplicationProjectAnalysis(malformed), path).toThrow(AnalysisError);
    }
  });

  test("validates complete excerpts and optional diagnostic evidence", () => {
    const project = analysis();
    const completeExcerpt = structuredClone(project);
    const completeAnchor = firstAnchor(completeExcerpt);
    (completeAnchor as { excerpt?: unknown }).excerpt = {
      range: structuredClone(completeAnchor.range),
      text: completeAnchor.text,
      complete: true,
    };
    expect(() => validateApplicationProjectAnalysis(completeExcerpt)).not.toThrow();

    const invalidExcerpts: readonly [string, (anchor: SourceAnchor) => void][] = [
      [
        "complete partial excerpt",
        (anchor) => {
          (anchor as { excerpt?: unknown }).excerpt = {
            range: {
              ...structuredClone(anchor.range),
              end: { ...anchor.range.end, offset: anchor.range.end.offset - 1 },
            },
            text: anchor.text.slice(0, -1),
            complete: true,
          };
        },
      ],
      [
        "excerpt outside anchor",
        (anchor) => {
          (anchor as { excerpt?: unknown }).excerpt = {
            range: {
              ...structuredClone(anchor.range),
              end: { ...anchor.range.end, offset: anchor.range.end.offset + 1 },
            },
            text: `${anchor.text}x`,
            complete: false,
          };
        },
      ],
      [
        "non-boolean completeness",
        (anchor) => {
          (anchor as { excerpt?: unknown }).excerpt = {
            range: structuredClone(anchor.range),
            text: anchor.text,
            complete: "yes",
          };
        },
      ],
    ];
    for (const [label, mutate] of invalidExcerpts) {
      const malformed = structuredClone(project);
      mutate(firstAnchor(malformed));
      expect(() => validateApplicationProjectAnalysis(malformed), label).toThrow(AnalysisError);
    }

    const withRelated = structuredClone(project);
    (withRelated.diagnostics[0] as { relatedInformation?: unknown }).relatedInformation = [
      {
        severity: "info",
        category: "message",
        code: 9000,
        message: "controlled related information",
        source: "fixture",
        path: "domain/src/diagnostic.ts",
        startOffset: 0,
        endOffset: 1,
        line: 1,
        column: 1,
      },
    ];
    expect(() => validateApplicationProjectAnalysis(withRelated)).not.toThrow();

    const diagnosticMutations: readonly [string, (diagnostic: Record<string, unknown>) => void][] =
      [
        ["inconsistent severity", (diagnostic) => (diagnostic.severity = "warning")],
        ["unknown category", (diagnostic) => (diagnostic.category = "unknown")],
        ["negative code", (diagnostic) => (diagnostic.code = -1)],
        ["non-text message", (diagnostic) => (diagnostic.message = 1)],
        ["empty source", (diagnostic) => (diagnostic.source = "")],
        ["reversed coordinates", (diagnostic) => (diagnostic.endOffset = -1)],
        ["unknown phase", (diagnostic) => (diagnostic.phase = "unknown")],
        ["non-array related information", (diagnostic) => (diagnostic.relatedInformation = {})],
      ];
    for (const [label, mutate] of diagnosticMutations) {
      const malformed = structuredClone(withRelated);
      mutate(malformed.diagnostics[0] as unknown as Record<string, unknown>);
      expect(() => validateApplicationProjectAnalysis(malformed), label).toThrow(AnalysisError);
    }
    const duplicateRelated = structuredClone(withRelated);
    const related = duplicateRelated.diagnostics[0].relatedInformation![0];
    (duplicateRelated.diagnostics[0].relatedInformation as unknown[]).push(
      structuredClone(related),
    );
    expectInvalid(duplicateRelated);

    const withManifestDiagnostic = structuredClone(project);
    (withManifestDiagnostic.manifestDiagnostics as unknown[]).push({
      severity: "warning",
      code: "MISSING_ENDPOINT_FALLBACK",
      definition: { kind: "endpoint", name: "Route" },
      endpoint: { name: "Route", path: "/route" },
      message: "controlled endpoint diagnostic",
    });
    (withManifestDiagnostic.resourceUsage as { diagnostics: number }).diagnostics += 1;
    expect(() => validateApplicationProjectAnalysis(withManifestDiagnostic)).not.toThrow();
    const malformedEndpoint = structuredClone(withManifestDiagnostic);
    (malformedEndpoint.manifestDiagnostics.at(-1)!.endpoint as unknown as { name: unknown }).name =
      1;
    expectInvalid(malformedEndpoint);
  });

  test("rejects cycles and transitive config, source, extends, and symlink escapes", () => {
    const cyclic = fixture();
    rewriteConfig(join(cyclic.root, "domain/tsconfig.json"), (config) => {
      config.references = [{ path: "../app" }];
    });
    expect(() => loadApplicationProject(fixtureOptions(cyclic))).toThrow(
      /references contain a cycle/,
    );

    const configEscape = fixture();
    rewriteConfig(join(configEscape.root, "app/tsconfig.json"), (config) => {
      config.references = [{ path: join(configEscape.outside, "base.json") }];
    });
    expect(() => loadApplicationProject(fixtureOptions(configEscape))).toThrow(
      /project reference.*escapes repositoryRoot/,
    );

    const sourceEscape = fixture();
    rewriteConfig(join(sourceEscape.root, "domain/tsconfig.json"), (config) => {
      config.files = [join(sourceEscape.outside, "outside.ts")];
    });
    expect(() => loadApplicationProject(fixtureOptions(sourceEscape))).toThrow(
      /source file.*escapes repositoryRoot/,
    );

    const importEscape = fixture();
    const appPath = join(importEscape.root, "app/src/app.ts");
    const outsideImport = relative(
      dirname(appPath),
      join(importEscape.outside, "outside.ts"),
    ).replaceAll("\\", "/");
    writeFileSync(
      appPath,
      `${readFileSync(appPath, "utf8")}\nimport ${JSON.stringify(outsideImport)};\n`,
    );
    expect(() => loadApplicationProject(fixtureOptions(importEscape))).toThrow(
      /source import escapes repositoryRoot/,
    );

    const extendsEscape = fixture();
    rewriteConfig(join(extendsEscape.root, "domain/tsconfig.json"), (config) => {
      config.extends = join(extendsEscape.outside, "base.json");
    });
    expect(() => loadApplicationProject(fixtureOptions(extendsEscape))).toThrow(
      /project read escapes repositoryRoot/,
    );

    const symlinkEscape = fixture();
    linkOutsideDirectory(symlinkEscape);
    rewriteConfig(join(symlinkEscape.root, "domain/tsconfig.json"), (config) => {
      config.extends = "../linked-outside/base.json";
    });
    expect(() => loadApplicationProject(fixtureOptions(symlinkEscape))).toThrow(
      /resolves outside repositoryRoot/,
    );
  });

  test("counts unique files, bytes, AST nodes, diagnostics, and anchors against every limit", () => {
    const projectFixture = fixture();
    const options = fixtureOptions(projectFixture);
    const baseline = loadApplicationProject(options);
    const fileBytes = baseline.provenance.files.map((file) =>
      Buffer.byteLength(readFileSync(join(projectFixture.root, file.path), "utf8"), "utf8"),
    );
    const exactBytes = fileBytes.reduce((total, bytes) => total + bytes, 0);
    expect(baseline.resourceUsage.projectFiles).toBe(baseline.provenance.files.length);
    expect(baseline.resourceUsage.projectBytes).toBe(exactBytes);
    expect(baseline.resourceUsage.astNodes).toBe(baseline.sourceIndex.resourceUsage.astNodes);

    for (const [limit, maximum] of [
      ["maxProjectFiles", baseline.resourceUsage.projectFiles - 1],
      ["maxProjectFileBytes", Math.max(...fileBytes) - 1],
      ["maxProjectTotalBytes", baseline.resourceUsage.projectBytes - 1],
      ["maxAstNodes", baseline.resourceUsage.astNodes - 1],
      ["maxDiagnostics", baseline.resourceUsage.diagnostics - 1],
      ["maxSourceAnchors", baseline.resourceUsage.sourceAnchors - 1],
    ] as const) {
      let caught: unknown;
      try {
        loadApplicationProject({ ...options, limits: { [limit]: maximum } });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AnalysisLimitError);
      expect(caught).toMatchObject({ limit, maximum });
    }
  }, 20_000);
});
