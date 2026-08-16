import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { Frames } from "@sync-engine/internal/reads/frames";
import { assemble } from "@sync-engine/assembly";
import { vocabulary } from "@sync-engine/advanced";
import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { vocabularyDeclaration, Sessioning } from "./fixtures/generated-artifacts/vocabulary.ts";
import {
  checkGenerated,
  inspectGenerated,
  pinGenerated,
  renderGenerated,
  resolveApplication,
} from "@engine/tooling/generated-artifacts";
import { inspectAssembly } from "@engine/tooling/inspection";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";
import { loadGeneratedApplication } from "@command/generated-config";

/**
 * A real config location — the packaged sample application — so the defaults
 * resolve against a project laid out the way the generator writes one.
 */
const configUrl = new URL("../../packaging/application/generated.config.ts", import.meta.url);
const languageModule = new URL("./fixtures/generated-artifacts/vocabulary.ts", import.meta.url);
const conceptFreeModule = new URL(
  "./fixtures/generated-artifacts/concept-free/vocabulary.ts",
  import.meta.url,
);
const conceptFreeVocabulary = vocabulary({ concepts: {}, computations: {} });
const fixtureDesign = (documents: readonly string[] = []) => ({
  version: 1 as const,
  documents: documents.map(
    (name) => new URL(`./fixtures/generated-artifacts/${name}.md`, import.meta.url),
  ),
});
const emptyDesign = fixtureDesign();
const loginDesign = fixtureDesign(["login"]);
const loginCurrentDesign = fixtureDesign(["login", "current"]);
const closureDesign = fixtureDesign(["closure"]);
const apiClosureDesign = fixtureDesign(["api-closure"]);
const Login = endpoint(
  "/login",
  ({ user, session, expiresAt }) =>
    receive({ user })
      .then(Sessioning.start({ user }).responds({ session, expiresAt }))
      .then(respond({ session, expiresAt })),
  { input: { required: ["user"] } },
);

const Current = endpoint(
  "/current",
  ({ session, user }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ user }))
      .then(respond({ user })),
  { input: { required: ["session"] } },
);

const Unanswered = endpoint("/unanswered", ({ user }) =>
  receive({ user }).then(Sessioning.start({ user })),
);

const ClosureEndpoint = endpoint("/closure", ({ hidden, user }) =>
  receive({})
    .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "kept" })))
    .then(Sessioning.current({ session: "fixed" }).responds({ user }))
    .then(respond({ hidden })),
);

describe("generated application artifacts", () => {
  test("the request boundary inventory contains only author-facing actions", async () => {
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Login },
    });
    const inspection = inspectAssembly(application);
    const boundary = inspection.concepts.find(({ name }) => name === "RequestBoundary");
    const rendered = (
      await renderGenerated(
        resolveApplication(
          {
            assemble: () => application,
            directory: new URL("./generated/", import.meta.url),
            title: "Application",
            design: loginDesign,
            conceptSet: { module: languageModule },
          },
          configUrl,
        ),
      )
    ).specification;

    expect(boundary?.actions.map(({ name }) => name)).toEqual(["request", "respond"]);
    expect(inspection.diagnostics.map(({ code }) => code)).toContain("MISSING_ENDPOINT_FALLBACK");
    expect(rendered).toContain("### Sessioning");
    expect(rendered).not.toContain("### RequestBoundary");
    expect(rendered).not.toMatch(/- `(register|cancel|respondFramework) /);
    expect(rendered).toContain("when RequestBoundary.request");
    expect(rendered).toContain("RequestBoundary.respond (");
  }, 15_000);

  test("assembles once while checking the exact generated application", async () => {
    let assemblies = 0;
    await renderGenerated(
      resolveApplication(
        {
          assemble: () => {
            assemblies += 1;
            return assemble({ vocabulary: vocabularyDeclaration, composition: { Login } });
          },
          directory: new URL("./not-written/", import.meta.url),
          title: "Single check",
          design: loginDesign,
          conceptSet: { module: languageModule },
        },
        configUrl,
      ),
    );
    expect(assemblies).toBe(1);
  }, 15_000);

  test("rebuilds source analysis for each programmatic inspection after source edits", async () => {
    const fixtureDirectory = fileURLToPath(
      new URL("./fixtures/generated-artifacts/", import.meta.url),
    );
    const temporary = await mkdtemp(join(fixtureDirectory, ".source-analysis-"));
    const modulePath = join(temporary, "vocabulary.ts");
    const specPath = join(temporary, "sessioning.md");
    const source = (parameter: "user" | "account") => `
import { vocabulary as declareVocabulary } from "@mit-sdg/sync-engine/advanced";
import sessioningSpec from "./sessioning.md" with { type: "text" };
export class SessioningConcept {
  start({ ${parameter} }: { ${parameter}: string }) {
    return { session: \`session-\${${parameter}}\`, expiresAt: new Date(0) };
  }
  current({ session }: { session: string }) { return { user: session }; }
}
export const vocabulary = declareVocabulary({
  concepts: { Sessioning: { class: SessioningConcept, spec: sessioningSpec } },
  computations: {},
});
`;
    try {
      await writeFile(specPath, await readFile(join(fixtureDirectory, "sessioning.md"), "utf8"));
      await writeFile(
        join(temporary, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            allowArbitraryExtensions: true,
            module: "NodeNext",
            moduleResolution: "NodeNext",
            target: "ESNext",
          },
          files: ["vocabulary.ts"],
        }),
      );
      await writeFile(modulePath, source("user"));
      const application = resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: { Login } }),
          directory: new URL("./not-written/", import.meta.url),
          title: "Fresh source analysis",
          design: loginDesign,
          conceptSet: { module: pathToFileURL(modulePath) },
        },
        configUrl,
      );

      const first = await inspectGenerated(application, (_assembly, analysis) =>
        analysis.context.source.getFullText(),
      );
      expect(first).toContain("start({ user }");

      await writeFile(modulePath, source("account"));
      const second = await inspectGenerated(application, (_assembly, analysis) =>
        analysis.context.source.getFullText(),
      );
      expect(second).toContain("start({ account }");
      expect(second).not.toContain("start({ user }");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  test("warns when an endpoint has no answer path", () => {
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Unanswered },
    });

    expect(inspectAssembly(application).diagnostics).toContainEqual({
      severity: "warning",
      code: "MISSING_ENDPOINT_FALLBACK",
      definition: { kind: "endpoint", name: "Unanswered" },
      endpoint: { name: "Unanswered", path: "/unanswered" },
      message:
        'Endpoint "Unanswered" at "/unanswered" has no recognized total answer path; an admitted request can time out when every answer guard drops.',
    });
  });

  test("the installed command prints exact, stackless help", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const expected = `Usage: sync-engine <command> [arguments]

  sync-engine setup [directory]
    Complete a Bun package manifest and initialize missing concept-free application files.

  sync-engine check-design <paths...>
    Check explicit authored-design Markdown without loading application code or configuration.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    manifest   Print the canonical application manifest as JSON.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

  sync-engine check [--config path] [--fail-on-warnings]
    Check the configured application, including concept TypeScript source agreement and application diagnostics.
    The configuration path defaults to generated.config.ts.\n`;
    const help = spawnSync("bun", ["src/command/main.ts", "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect({ status: help.status, stdout: help.stdout, stderr: help.stderr }).toEqual({
      status: 0,
      stdout: expected,
      stderr: "",
    });

    const unknown = spawnSync("bun", ["src/command/main.ts", "unknown"], {
      cwd: root,
      encoding: "utf8",
    });
    expect({ status: unknown.status, stdout: unknown.stdout, stderr: unknown.stderr }).toEqual({
      status: 1,
      stdout: "",
      stderr: expected,
    });
  });

  test("installed commands reject unknown flags and trailing arguments before effects", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-cli-args-"));
    const main = join(root, "src/command/main.ts");
    const run = (...args: string[]) =>
      spawnSync("bun", [main, ...args], { cwd: temporary, encoding: "utf8" });
    try {
      await writeFile(
        join(temporary, "generated.config.ts"),
        'await Bun.write(new URL("./imported", import.meta.url), "imported");\nexport default {};\n',
      );

      const typo = run("artifacts", "pin", "--confgi", "ignored.config.ts");
      expect(typo.status).toBe(1);
      expect(typo.stderr).toContain("sync-engine artifacts <command> [--config path]");
      expect(existsSync(join(temporary, "imported"))).toBe(false);

      const trailing = run("new", "valid-project", "trailing");
      expect(trailing.status).toBe(1);
      expect(trailing.stderr).toContain("Usage: sync-engine <command> [arguments]");
      expect(existsSync(join(temporary, "valid-project"))).toBe(false);

      const helpTrailing = run("--help", "trailing");
      expect(helpTrailing.status).toBe(1);
      expect(helpTrailing.stdout).toBe("");
      expect(helpTrailing.stderr).toContain("Usage: sync-engine <command> [arguments]");

      const unknown = run("check", "--unknown");
      expect(unknown.status).toBe(1);
      expect(unknown.stderr).toContain("sync-engine check [--config path]");

      const removedMode = run("check", "--vocabulary-module", "src/application-concepts.ts");
      expect(removedMode.status).toBe(1);
      expect(removedMode.stderr).toContain("sync-engine check [--config path]");
      expect(existsSync(join(temporary, "imported"))).toBe(false);

      await rm(join(temporary, "generated.config.ts"));
      const missingDefault = run("check");
      expect(missingDefault.status).toBe(1);
      expect(missingDefault.stderr).toContain("Configuration does not exist: generated.config.ts");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  test("HTTP policies project cookie and logical fields in one generated operation", async () => {
    const cookieProjection = httpWire({
      name: "ApplicationWireHttpCookie",
      policy: httpPolicy({
        publicOrigin: "http://localhost:3000",
        cookies: {
          session: {
            name: "session",
            input: "session",
            issue: [{ path: "/login", value: "session", expires: "expiresAt" }],
            clear: [],
          },
        },
      }),
    });
    const logicalProjection = httpWire({
      name: "ApplicationWireHttp",
      policy: httpPolicy({ publicOrigin: "https://example.test" }),
    });
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Login, Current },
    });
    const rendered = await renderGenerated(
      resolveApplication(
        {
          assemble: () => application,
          directory: new URL("./generated/", import.meta.url),
          title: "Application",
          design: loginCurrentDesign,
          conceptSet: { module: languageModule },
          projections: [
            cookieProjection,
            {
              ...logicalProjection,
              project(facts) {
                return {
                  ...logicalProjection.project(facts),
                  render: { appWideErrorName: "PlainHttpAppWideError" },
                };
              },
            },
          ],
        },
        configUrl,
      ),
    );

    expect(rendered.wire.match(/export type Json =/g)).toHaveLength(1);
    expect(rendered.wire).toContain("export type ApplicationWire = {");
    expect(rendered.wire).toContain('"session": Jsonify<');
    expect(rendered.wire).toContain("export type HttpAppWideError =");
    expect(rendered.wire).toContain("export type ApplicationWireHttpCookie = {");
    expect(rendered.wire).toContain("export type PlainHttpAppWideError =");
    expect(rendered.wire).toContain("export type ApplicationWireHttp = {");

    const cookie = rendered.wire.slice(
      rendered.wire.indexOf("ApplicationWireHttpCookie"),
      rendered.wire.indexOf("PlainHttpAppWideError"),
    );
    expect(cookie).not.toContain('"session":');
    const logical = rendered.wire.slice(rendered.wire.indexOf("ApplicationWireHttp ="));
    expect(logical).toContain('"session":');
    expect(logical).toContain('error: { error: PlainHttpAppWideError | "INVALID_REQUEST" }');
  }, 15_000);

  test("ordinary assembly rejects an executable endpoint absent from portable IR", async () => {
    const application = resolveApplication(
      {
        assemble: () =>
          assemble({
            vocabulary: vocabularyDeclaration,
            composition: { Api: { ClosureEndpoint } },
          }),
        directory: new URL("./not-written/", import.meta.url),
        title: "Incomplete application",
        design: apiClosureDesign,
        conceptSet: { module: languageModule },
      },
      configUrl,
    );
    const message =
      'local reaction "Api.ClosureEndpoint": unlowered reaction: ' +
      "step 2 needs a value bound by a closure where";

    await expect(renderGenerated(application)).rejects.toThrow(message);
    await expect(checkGenerated(application)).rejects.toThrow(message);
    await expect(pinGenerated(application)).rejects.toThrow(message);
  });

  test("the CLI fails closed instead of printing a partial wire contract", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const config = fileURLToPath(new URL("./unlowered-endpoint.config.ts", import.meta.url));
    const result = spawnSync(
      "bun",
      ["src/command/main.ts", "artifacts", "wire", "--config", config],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('local reaction "Api.ClosureEndpoint": unlowered reaction');
    expect(result.stderr).toContain("step 2 needs a value bound by a closure where");
  });

  test("assembly locality failure happens before any artifact path is created", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-locality-"));
    const directory = pathToFileURL(`${join(temporary, "generated")}/`);
    const application = resolveApplication(
      {
        assemble: () =>
          assemble({
            vocabulary: vocabularyDeclaration,
            composition: { ClosureEndpoint },
          }),
        directory,
        title: "Rejected local endpoint",
        design: closureDesign,
        conceptSet: { module: languageModule },
      },
      configUrl,
    );
    try {
      await expect(pinGenerated(application)).rejects.toThrow(
        /ordinary assembly accepts portable behavior only/,
      );
      expect(existsSync(directory)).toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("encoded traversal is rejected before the filesystem adapter writes", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-path-"));
    const generated = join(temporary, "generated");
    const escaped = join(temporary, "escape.md");
    const application = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: conceptFreeVocabulary, composition: {} }),
        directory: pathToFileURL(`${generated}/`),
        specification: "%2e%2e/escape.md",
        title: "Unsafe path application",
        design: emptyDesign,
        conceptSet: { module: conceptFreeModule },
      },
      configUrl,
    );

    try {
      for (const artifact of ["specification", "wire"] as const) {
        await expect(pinGenerated(application, artifact)).rejects.toThrow(
          /relative POSIX|escapes or does not normalize/,
        );
      }
      expect(existsSync(escaped)).toBe(false);
      expect(existsSync(generated)).toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  test("rejects canonical output collisions with every registered authoritative input kind", async () => {
    const fixtureDirectory = new URL("./fixtures/generated-artifacts/", import.meta.url);
    const cases = [
      {
        label: "generated config",
        directory: new URL("../../packaging/application/", import.meta.url),
        specification: "generated.config.ts",
        authored: false,
      },
      {
        label: "design document",
        directory: fixtureDirectory,
        specification: "login.md",
        authored: true,
      },
      {
        label: "concept specification",
        directory: fixtureDirectory,
        specification: "sessioning.md",
        authored: true,
      },
      {
        label: "concept-set module",
        directory: new URL("./fixtures/generated-artifacts/concept-free/", import.meta.url),
        specification: "vocabulary.ts",
        authored: false,
      },
    ] as const;

    for (const collision of cases) {
      const application = resolveApplication(
        {
          assemble: () =>
            collision.authored
              ? assemble({ vocabulary: vocabularyDeclaration, composition: { Login } })
              : assemble({ vocabulary: conceptFreeVocabulary, composition: {} }),
          directory: collision.directory,
          specification: collision.specification,
          title: "Colliding application",
          design: collision.authored ? loginDesign : emptyDesign,
          conceptSet: { module: collision.authored ? languageModule : conceptFreeModule },
        },
        configUrl,
      );
      await expect(pinGenerated(application, "specification")).rejects.toThrow(
        new RegExp(`collides with authoritative ${collision.label}`),
      );
    }
  }, 30_000);

  test("canonicalization rejects a symlinked output alias of a registered design source", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-alias-"));
    const alias = join(temporary, "design-alias.md");
    const designPath = fileURLToPath(
      new URL("./fixtures/generated-artifacts/login.md", import.meta.url),
    );
    try {
      await symlink(designPath, alias);
      const application = resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: { Login } }),
          directory: pathToFileURL(`${temporary}/`),
          specification: "design-alias.md",
          title: "Aliased collision",
          design: loginDesign,
          conceptSet: { module: languageModule },
        },
        configUrl,
      );
      await expect(pinGenerated(application, "specification")).rejects.toThrow(
        /collides with authoritative design document/,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 15_000);

  test("selectively pins atomic files and detects missing or changed output", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-"));
    const generated = join(temporary, "generated");
    const directory = pathToFileURL(`${generated}/`);
    const application = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: conceptFreeVocabulary, composition: {} }),
        directory,
        title: "Filesystem application",
        design: emptyDesign,
        conceptSet: { module: conceptFreeModule },
      },
      configUrl,
    );
    const specification = join(generated, "filesystem-application.md");
    const wire = join(generated, "wire.ts");

    try {
      await pinGenerated(application, "specification");
      expect(existsSync(specification)).toBe(true);
      expect(existsSync(wire)).toBe(false);
      await expect(checkGenerated(application)).rejects.toThrow(
        "wire.ts differ from generated output",
      );

      await pinGenerated(application, "wire");
      await expect(checkGenerated(application)).resolves.toBeUndefined();

      await writeFile(specification, "stale generated output");
      await expect(checkGenerated(application)).rejects.toThrow(
        "filesystem-application.md differ from generated output",
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 60_000);

  test("reports generated artifact filesystem failures without partial writes", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-failure-"));
    const generated = join(temporary, "generated");
    const blocked = join(generated, "blocked.md");
    await mkdir(blocked, { recursive: true });
    const application = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: conceptFreeVocabulary, composition: {} }),
        directory: pathToFileURL(`${generated}/`),
        specification: "blocked.md",
        title: "Blocked application",
        design: emptyDesign,
        conceptSet: { module: conceptFreeModule },
      },
      configUrl,
    );

    try {
      await expect(checkGenerated(application)).rejects.toThrow(
        "generated artifacts: failed to check blocked.md",
      );
      await expect(pinGenerated(application, "specification")).rejects.toThrow(
        "generated artifacts: failed to apply blocked.md",
      );
      expect(existsSync(join(generated, "wire.ts"))).toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }, 30_000);

  test("drains inspection before closing application-owned generation resources", async () => {
    const lifecycle: string[] = [];
    const application = resolveApplication(
      {
        assemble: () =>
          assemble({
            vocabulary: vocabularyDeclaration,
            composition: { Login },
            observers: [
              (event) => {
                if (event.type === "drain-state") lifecycle.push(event.state);
              },
            ],
          }),
        async close() {
          lifecycle.push("closed");
        },
        directory: new URL("./not-written/", import.meta.url),
        title: "Lifecycle application",
        design: loginDesign,
        conceptSet: { module: languageModule },
      },
      configUrl,
    );

    await renderGenerated(application);

    expect(lifecycle).toEqual(["draining", "idle", "closed"]);
  });

  test("closes application-owned resources when assembly inspection fails", async () => {
    let closed = false;
    const application = resolveApplication(
      {
        assemble: () => {
          throw new Error("assembly failed");
        },
        async close() {
          closed = true;
        },
        title: "Failed lifecycle application",
        design: emptyDesign,
        conceptSet: { module: languageModule },
      },
      configUrl,
    );

    await expect(renderGenerated(application)).rejects.toThrow("assembly failed");
    expect(closed).toBe(true);
  });
});

describe("an artifact configuration's defaults", () => {
  test("the command loader resolves a generated configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-engine-config-"));
    try {
      await mkdir(join(directory, "src"));
      await writeFile(
        join(directory, "generated.config.ts"),
        'export default { assemble() {}, title: "Loaded application", design: { version: 1, documents: [] } };\n',
      );
      await writeFile(
        join(directory, "src/concepts.ts"),
        "export const applicationConceptSet = {};\n",
      );
      const resolved = await loadGeneratedApplication("generated.config.ts", directory);
      expect(resolved.title).toBe("Loaded application");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("resolves registered local design sources outside the application directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-design-config-"));
    try {
      const applicationDirectory = join(root, "application");
      const sharedDirectory = join(root, "shared-design");
      await mkdir(applicationDirectory, { recursive: true });
      await mkdir(sharedDirectory, { recursive: true });
      const typesDesign = pathToFileURL(join(applicationDirectory, "types.md"));
      const sharedDesign = pathToFileURL(join(sharedDirectory, "behavior.md"));
      await writeFile(typesDesign, "# Application types\n");
      await writeFile(sharedDesign, "# Shared behavior\n");
      const localConfig = pathToFileURL(join(applicationDirectory, "generated.config.ts"));

      const resolved = resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
          title: "Registered design",
          design: { version: 1, documents: [typesDesign, sharedDesign] },
          conceptSet: { module: languageModule },
        },
        localConfig,
      );

      expect(resolved.design).toEqual({
        version: 1,
        documents: [typesDesign, sharedDesign],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires and validates every design registration", () => {
    const application = {
      assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
      title: "Design validation",
      conceptSet: { module: languageModule },
    };
    const resolveDesign = (design?: unknown) =>
      resolveApplication(
        { ...application, ...(design === undefined ? {} : { design }) } as never,
        configUrl,
      );

    expect(() => resolveDesign()).toThrow("design block is required");
    expect(() => resolveDesign({ version: 2, documents: [] })).toThrow("design.version must be 1");
    expect(() => resolveDesign({ version: 1, vocabulary: configUrl, documents: [] })).toThrow(
      "design.vocabulary was removed",
    );
    expect(() => resolveDesign({ version: 1 })).toThrow("design.documents must be an array");
    expect(() => resolveDesign({ version: 1, documents: ["design.md"] })).toThrow(
      "design.documents[0] must be a URL",
    );
    expect(() =>
      resolveDesign({ version: 1, documents: [new URL("https://example.test/design.md")] }),
    ).toThrow("design.documents[0] must be a local file URL, not https:");
    expect(() =>
      resolveDesign({
        version: 1,
        documents: [new URL("./absent-design.md", import.meta.url)],
      }),
    ).toThrow(/design\.documents\[0\] does not exist: .*absent-design\.md/);
    expect(() => resolveDesign({ version: 1, documents: [configUrl, configUrl] })).toThrow(
      "design.documents[1] duplicates design.documents[0]",
    );
    expect(() =>
      resolveApplication(
        { ...application, design: emptyDesign, vocabulary: { module: languageModule } } as never,
        configUrl,
      ),
    ).toThrow("top-level vocabulary was replaced by conceptSet");
  });

  test("a title and an assembly use the conventional concept-set source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-engine-default-config-"));
    try {
      await mkdir(join(directory, "src"));
      await writeFile(
        join(directory, "src/concepts.ts"),
        "export const applicationConceptSet = {};\n",
      );
      const compatibilityConfigUrl = pathToFileURL(join(directory, "generated.config.ts"));
      const resolved = resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
          title: "Reading circle",
          design: emptyDesign,
        },
        compatibilityConfigUrl,
      );
      expect({
        directory: resolved.directory.href,
        specification: resolved.specification,
        wire: resolved.wire,
        wireName: resolved.wireName,
        wireBanner: resolved.wireBanner,
        conceptSetFrom: resolved.conceptSetFrom,
      }).toEqual({
        directory: new URL("./generated/", compatibilityConfigUrl).href,
        specification: "reading-circle.md",
        wire: "wire.ts",
        wireName: "ReadingCircleWire",
        wireBanner: undefined,
        conceptSetFrom: { from: "../src/concepts.ts", export: "applicationConceptSet" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("explicit names, paths, and banners override the derived output", async () => {
    const resolved = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
        title: "Reading circle",
        design: emptyDesign,
        specification: "book.md",
        specificationBanner: "<!-- Project specification -->",
        wireName: "CircleContracts",
        wireBanner: "// Project wire contract",
        conceptSet: { module: languageModule, export: "words" },
      },
      configUrl,
    );
    const rendered = await renderGenerated(resolved);
    expect(resolved.specification).toBe("book.md");
    expect(resolved.wireName).toBe("CircleContracts");
    expect(resolved.conceptSetFrom.export).toBe("words");
    expect(
      rendered.specification.startsWith(
        `<!-- Project specification -->\n<!-- Manifest producer: ${PACKAGE_NAME}@${PACKAGE_VERSION}; concept specification: sync-engine.concept-specification@1; renderer: ${PACKAGE_NAME}@${PACKAGE_VERSION}. -->`,
      ),
    ).toBe(true);
    expect(
      rendered.wire.startsWith(
        `// Project wire contract\n// Generator: ${PACKAGE_NAME}@${PACKAGE_VERSION}.`,
      ),
    ).toBe(true);
  });

  test("a concept-set module that is not there fails by path", () => {
    expect(() =>
      resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
          title: "Reading circle",
          design: emptyDesign,
          conceptSet: { module: new URL("./absent/concept-set.ts", import.meta.url) },
        },
        configUrl,
      ),
    ).toThrow(/no concept-set module at .*absent[/\\]concept-set\.ts/);
  });

  test("a configuration without a title fails", () => {
    expect(() => resolveApplication({ title: "" } as never, configUrl)).toThrow(
      "title must name the application",
    );
  });

  test("a configuration close hook must be callable", () => {
    expect(() =>
      resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
          close: true,
          title: "Invalid lifecycle",
        } as never,
        configUrl,
      ),
    ).toThrow("close must release generation resources");
  });
});
