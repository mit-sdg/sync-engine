import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";
import { assemble, Logging } from "@sync-engine/assembly";
import {
  createGateway,
  endpoint,
  FrameworkErrorCode,
  receive,
  respond,
} from "@sync-engine/boundary";
import { compute, reaction, vocabulary, when } from "@sync-engine/language";
import { inspectAssembly, renderInputContracts } from "@sync-engine/tooling";

class DuplicateTitle extends Error {}

function ownPropertyText(value: unknown): string {
  const seen = new Set<object>();
  const visit = (current: unknown): string => {
    if (typeof current === "string" || typeof current === "symbol") return String(current);
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function") ||
      seen.has(current)
    ) {
      return "";
    }
    seen.add(current);
    return Reflect.ownKeys(current)
      .map((key) => `${String(key)} ${visit(Object.getOwnPropertyDescriptor(current, key)?.value)}`)
      .join(" ");
  };
  return visit(value);
}

// Deliberately plain: concept classes know only their own state and protocol.
class Cataloging {
  private readonly titles = new Set<string>();

  add({ title }: { title: string }) {
    if (this.titles.has(title)) throw new DuplicateTitle("That title already exists.");
    this.titles.add(title);
    return { title };
  }

  _titles(_: Record<string, never>) {
    return [...this.titles].map((title) => ({ title }));
  }
}

describe("canonical public API", () => {
  test("vocabulary reads purpose and principle from its spec field", () => {
    const words = vocabulary({
      concepts: {
        Cataloging: {
          class: Cataloging,
          spec: "# Cataloging\n\n## Purpose\n\nKeep titles.\n\n## Principle\n\nA title appears once.",
        },
      },
      computations: {},
    });
    const system = assemble({ vocabulary: words, composition: {} });
    expect(inspectAssembly(system).concepts).toContainEqual(
      expect.objectContaining({
        name: "Cataloging",
        purpose: "Keep titles.",
        principle: "A title appears once.",
      }),
    );
  });

  test("a vocabulary owns concepts, computations, metadata, and refusals", async () => {
    const words = vocabulary({
      concepts: {
        Cataloging: {
          class: Cataloging,
          purpose: "Keep one catalog of distinct titles.",
          principle: "Adding a new title records it; adding the same title is refused.",
          refusals: {
            add: [
              {
                code: "DUPLICATE_TITLE",
                error: DuplicateTitle,
                message: "This title is already in the catalog.",
              },
            ],
          },
        },
      },
      computations: {
        normalizeTitle: ({ title }) => String(title).trim().toLowerCase(),
      },
    });
    const { Cataloging: Catalog } = words.concepts;
    const { normalizeTitle } = words.computations;

    const Add = endpoint("/catalog/add", ({ raw, title }) =>
      receive({ raw })
        .where(compute(normalizeTitle, { title: raw }, title))
        .then(Catalog.add({ title }).responds({ title }))
        .then(respond({ title })),
    );
    const system = assemble({ vocabulary: words, composition: { Add } });
    expect(Logging.OFF).toBe(0);
    expect(await system.invoker.invoke("/catalog/add", { raw: "  Example " })).toEqual({
      ok: true,
      value: { title: "example" },
    });
    expect(await system.invoker.invoke("/catalog/add", { raw: "EXAMPLE" })).toEqual({
      ok: false,
      error: {
        kind: "domain",
        value: "DUPLICATE_TITLE",
      },
    });
    expect(await system.concepts.Cataloging.add({ title: "example" })).toEqual({
      error: "DUPLICATE_TITLE",
      detail: "This title is already in the catalog.",
    });

    const gateway = createGateway({ application: system });
    expect(await gateway.invoke("/catalog/add", { raw: "Other" })).toEqual({
      ok: true,
      value: { title: "other" },
    });
    expect("engine" in system).toBe(false);
    const inspected = inspectAssembly(system);
    expect(inspected.app.reactions.some((reaction) => reaction.name === "Add")).toBe(true);
    expect(inspected.concepts.some((concept) => concept.name === "Cataloging")).toBe(true);
    expect(renderInputContracts(inspected.inputContracts)).toContain("/catalog/add");
    expect(inspected.occurrences.some((entry) => entry.concept === "Cataloging")).toBe(true);
    expect(inspected.readBack).toContain("Add");
    expect(inspected.readBack).toContain("then Cataloging.add");
  });

  test("inspection redacts credential-shaped action outputs", async () => {
    const sessionToken = "inspection-session-token-sentinel";
    class Sessioning {
      start(_: Record<PropertyKey, never>) {
        return { sessionToken };
      }
    }
    const words = vocabulary({ concepts: { Sessioning }, computations: {} });
    const { Sessioning: Session } = words.concepts;
    const Start = endpoint("/sessions/start", ({ token }) =>
      receive()
        .then(Session.start({}).responds({ sessionToken: token }))
        .then(respond({ sessionToken: token })),
    );
    const system = assemble({ vocabulary: words, composition: { Start } });

    expect(await system.invoker.invoke("/sessions/start", {} as never)).toEqual({
      ok: true,
      value: { sessionToken },
    });
    const inspected = inspectAssembly(system);
    const occurrence = inspected.occurrences.find(
      (candidate) => candidate.concept === "Sessioning" && candidate.action === "start",
    );
    expect(occurrence?.output).toEqual({ sessionToken: "[redacted]" });
    expect(occurrence?.outcome).toEqual({
      kind: "result",
      value: { sessionToken: "[redacted]" },
    });
    expect(ownPropertyText(inspected.occurrences)).not.toContain(sessionToken);
  });

  test("an assembled reaction cannot borrow another vocabulary's computation", () => {
    const owned = vocabulary({
      concepts: { Cataloging },
      computations: { normalize: ({ value }) => String(value).trim() },
    });
    const borrowed = vocabulary({
      concepts: {},
      computations: { normalize: ({ value }) => String(value).trim() },
    });
    const { Cataloging: Catalog } = owned.concepts;
    const ForeignReaction = reaction(({ raw, title }) =>
      when(Catalog.add({ title: raw }).responds())
        .where(compute(borrowed.computations.normalize, { value: raw }, title))
        .then(Catalog.add({ title })),
    );

    expect(() => assemble({ vocabulary: owned, composition: { ForeignReaction } })).toThrow(
      /not the definition installed by this assembly/,
    );
  });

  test("vocabulary metadata names real members and one instance has one declaration", () => {
    const reads = vocabulary({
      concepts: {
        Cataloging: { class: Cataloging, queries: { _titles: "many" } },
      },
      computations: {},
    }).concepts.Cataloging;
    expect((reads._titles as unknown as { queryPromise?: string }).queryPromise).toBe("many");

    expect(() =>
      vocabulary({
        concepts: {
          Cataloging: { class: Cataloging, queries: { _missing: "many" } } as never,
        },
        computations: {},
      }),
    ).toThrow(/queries contract names "_missing"/);

    expect(() =>
      vocabulary({
        concepts: {
          Cataloging: {
            class: Cataloging,
            refusals: {
              missingAction: [
                { code: "NOPE", error: DuplicateTitle, message: "There is no such action." },
              ],
            },
          },
        },
        computations: {},
      }),
    ).toThrow(/Cataloging.missingAction.*not an action/);

    const first = vocabulary({
      concepts: { Cataloging: { class: Cataloging, purpose: "First declaration." } },
      computations: {},
    });
    const second = vocabulary({
      concepts: { Cataloging: { class: Cataloging, purpose: "Second declaration." } },
      computations: {},
    });
    const shared = new Cataloging();
    assemble({ vocabulary: first, instances: { Cataloging: shared }, composition: {} });
    expect(() =>
      assemble({ vocabulary: second, instances: { Cataloging: shared }, composition: {} }),
    ).toThrow(/cannot carry two vocabulary declarations/);
  });
});

const register = {
  language: [
    "Condition",
    "Former",
    "QueryPromise",
    "ReadLine",
    "RelationView",
    "count",
    "compute",
    "each",
    "earlier",
    "form",
    "former",
    "is",
    "no",
    "reaction",
    "refused",
    "returned",
    "view",
    "vocabulary",
    "when",
    "where",
    "whether",
  ],
  assembly: [
    "ActionRefusal",
    "Assembly",
    "AssemblyOptions",
    "ConceptFloor",
    "ConceptImplementation",
    "ConceptRegistration",
    "ExecutionLimits",
    "FileLogSink",
    "FiringRecord",
    "ImplementationOverrides",
    "Implementations",
    "IntegrityFailureRecord",
    "LogEntry",
    "LogSink",
    "Logging",
    "OperationalEvent",
    "OperationalObserver",
    "OperationalResultClass",
    "QueryCacheMode",
    "ReactionFailureRecord",
    "RawFaultReport",
    "RawFaultReporter",
    "RegisteredConcept",
    "RegisteredConceptSet",
    "RetentionPolicy",
    "assemble",
    "conceptFloor",
    "conceptSet",
    "registerConcept",
  ],
  boundary: [
    "ApplicationInterface",
    "TransportBinding",
    "WireProjectionFacts",
    "EndpointDef",
    "EndpointOptions",
    "EndpointValidator",
    "EndpointValidators",
    "ExecutionLimits",
    "FrameworkErrorCode",
    "Gateway",
    "GatewayOptions",
    "GatewayTarget",
    "InputContractDecl",
    "InvocationResult",
    "InvokeOptions",
    "Invoker",
    "OperationalEvent",
    "OperationalObserver",
    "OperationalResultClass",
    "ValidationResult",
    "assertPortableRoutePath",
    "bindTransport",
    "createGateway",
    "endpoint",
    "receive",
    "respond",
    "serializeJsonValue",
  ],
  client: [
    "Client",
    "ClientCallOptions",
    "ClientError",
    "ClientOptions",
    "ClientRequest",
    "ClientResponseValidator",
    "ClientTransport",
    "ContractShape",
    "DomainErrorValue",
    "createClient",
    "createLocalClient",
  ],
  tooling: [
    "AppIR",
    "ApplicationDiagnostic",
    "ApplicationManifestV3",
    "ConceptInventoryIR",
    "DiagnosticCode",
    "DiagnosticSeverity",
    "FormerIR",
    "GeneratedApplication",
    "ManifestEndpointV3",
    "ObservedOccurrence",
    "PlannedWireProjection",
    "ProjectionProvenance",
    "ProjectionRenderOptions",
    "ReactionIR",
    "ViewIR",
    "WireContractsIR",
    "WireEndpoint",
    "WireOptions",
    "WireProjection",
    "WireProjectionResult",
    "WireRenderOptions",
    "WireType",
    "applicationDiagnostics",
    "applicationManifest",
    "diagnosticsFail",
    "inspectAssembly",
    "renderApp",
    "renderApplicationManifest",
    "renderInputContracts",
    "renderReaction",
    "renderWireTypes",
    "wireContracts",
  ],
  advanced: [
    "Engine",
    "EngineObserver",
    "EngineOptions",
    "LogEvent",
    "Refuse",
    "createEngine",
    "custom",
    "faulted",
  ],
} as const;

const httpRegister = {
  client: [
    "HeadersOption",
    "HttpClientError",
    "HttpClientErrorCode",
    "HttpClientOptions",
    "HttpRequestContext",
    "createHttpClient",
    "createHttpTransport",
  ],
  server: [
    "HttpCorrelationOptions",
    "HttpCredentialBinding",
    "HttpFloor",
    "HttpPublicErrorCategory",
    "HttpPublicErrorPolicy",
    "ProductionHttpProfile",
    "createHttpHandler",
    "httpFloor",
    "productionHttpProfile",
  ],
  tooling: ["HttpWireOptions", "httpWire"],
} as const;

const packageJson = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { exports: Record<string, unknown> };
const packageSubpaths = Object.keys(packageJson.exports).map((subpath) => subpath.slice(2));

const frameworkErrorCodes = [
  "ABORTED",
  "INTERNAL_ERROR",
  "INVALID_INPUT",
  "NOT_FOUND",
  "TIMED_OUT",
  "TRANSPORT_ERROR",
  "UNAVAILABLE",
  "UNKNOWN_ERROR",
] as const;

function referenceSubpathBlock(subpath: keyof typeof register): string {
  const exports = register[subpath].map((name) => `\`${name}\``).join(", ");
  return [
    `## \`${subpath}\``,
    "",
    `<!-- register:${subpath}:start -->`,
    "",
    exports,
    "",
    `<!-- register:${subpath}:end -->`,
  ].join("\n");
}

function referenceHttpSubpathBlock(subpath: keyof typeof httpRegister): string {
  const exports = httpRegister[subpath].map((name) => `\`${name}\``).join(", ");
  return [
    `<!-- register:http-${subpath}:start -->`,
    "",
    exports,
    "",
    `<!-- register:http-${subpath}:end -->`,
  ].join("\n");
}

function filesUnder(directory: string, suffix?: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "coverage", "dist", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, suffix));
    else if (suffix === undefined || entry.name.endsWith(suffix)) files.push(path);
  }
  return files;
}

describe("public API register", () => {
  test("the registered public entrypoints have their exact exports and contain only exports", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const sourceRoot = resolve(root, "src");
    const configPath = resolve(root, "tsconfig.json");
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const entrypoints = packageSubpaths.map((subpath) => resolve(sourceRoot, subpath, "index.ts"));
    const files = [...entrypoints, ...filesUnder(resolve(sourceRoot, "engine"), ".ts")];
    const program = ts.createProgram({ rootNames: files, options: parsed.options });
    const checker = program.getTypeChecker();

    const names = new Map<string, ts.Symbol>();
    const symbols = new Map<ts.Symbol, string>();
    for (const subpath of packageSubpaths) {
      const expected = register[subpath as keyof typeof register];
      expect(expected, `${subpath} export register`).toBeDefined();
      const source = program.getSourceFile(resolve(sourceRoot, subpath, "index.ts"));
      expect(source, `${subpath} source`).toBeDefined();
      expect(source?.statements.every(ts.isExportDeclaration), `${subpath} exports only`).toBe(
        true,
      );
      const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
      const exported = symbol === undefined ? [] : checker.getExportsOfModule(symbol);
      const actual = exported.map(({ name }) => name).sort();
      expect(actual, subpath).toEqual([...expected].sort());

      for (const exposed of exported) {
        const target =
          (exposed.flags & ts.SymbolFlags.Alias) === 0
            ? exposed
            : checker.getAliasedSymbol(exposed);
        const sameName = names.get(exposed.name);
        expect(sameName === undefined || sameName === target, `homograph: ${exposed.name}`).toBe(
          true,
        );
        names.set(exposed.name, target);

        const priorName = symbols.get(target);
        expect(
          priorName === undefined || priorName === exposed.name,
          `synonym: ${priorName ?? "?"} / ${exposed.name}`,
        ).toBe(true);
        symbols.set(target, exposed.name);
      }
    }
  }, 15_000);

  test("the package exposes exactly the registered public subpaths", () => {
    expect(packageSubpaths.sort()).toEqual(Object.keys(register).sort());
  });

  test("the HTTP companion barrels and reference have their exact exports", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const packageRoot = resolve(root, "packages/http");
    const httpPackage = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(httpPackage.exports).sort()).toEqual(
      Object.keys(httpRegister)
        .map((subpath) => `./${subpath}`)
        .sort(),
    );

    const reference = readFileSync(resolve(root, "packages/http/public-surface.md"), "utf8");
    for (const subpath of Object.keys(httpRegister) as Array<keyof typeof httpRegister>) {
      const sourceText = readFileSync(resolve(packageRoot, "src", subpath, "index.ts"), "utf8");
      const source = ts.createSourceFile("index.ts", sourceText, ts.ScriptTarget.Latest, true);
      expect(source.statements.every(ts.isExportDeclaration), `${subpath} exports only`).toBe(true);
      const actual = source.statements.flatMap((statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(({ name }) => name.text)
          : [],
      );
      expect(actual.sort(), subpath).toEqual([...httpRegister[subpath]].sort());

      const block = referenceHttpSubpathBlock(subpath);
      expect(reference, `${subpath} full package path`).toContain(
        `@mit-sdg/sync-engine-http/${subpath}`,
      );
      expect(reference, `${subpath} reference unit`).toContain(block);
      expect(reference.indexOf(block), `${subpath} reference unit is unique`).toBe(
        reference.lastIndexOf(block),
      );
    }
  });

  test("nested public constants and shipped declarations contain no unsupported entrypoints", () => {
    expect(Object.keys(FrameworkErrorCode).sort()).toEqual([...frameworkErrorCodes].sort());

    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const sourceRoot = resolve(root, "src");
    const shippedFiles = [
      ...Object.keys(register).flatMap((subpath) =>
        filesUnder(resolve(sourceRoot, subpath), ".ts"),
      ),
      ...filesUnder(resolve(sourceRoot, "engine"), ".ts"),
    ];
    const findings: string[] = [];
    for (const file of shippedFiles) {
      const source = readFileSync(file, "utf8");
      if (/@deprecated\b/i.test(source)) {
        findings.push(`${file.slice(root.length + 1)}:@deprecated`);
      }
      if (/\bspecificationProse\b/.test(source)) {
        findings.push(`${file.slice(root.length + 1)}:specificationProse`);
      }
    }
    expect(findings).toEqual([]);
  });

  test("the public API reference pins one generated unit for every package subpath", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const reference = readFileSync(resolve(root, "docs/public-surface.md"), "utf8");
    let previous = -1;
    for (const subpath of Object.keys(register) as Array<keyof typeof register>) {
      const block = referenceSubpathBlock(subpath);
      const position = reference.indexOf(block);
      expect(reference, `${subpath} full package path`).toContain(
        `@mit-sdg/sync-engine/${subpath}`,
      );
      expect(position, `${subpath} reference unit`).toBeGreaterThan(previous);
      expect(reference.indexOf(block, position + 1), `${subpath} reference unit is unique`).toBe(
        -1,
      );
      previous = position;
    }
    expect([...reference.matchAll(/^## `([^`]+)`$/gm)].map((match) => match[1])).toEqual(
      Object.keys(register),
    );
  });
});
