import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/language";
import { endpoint, productionHttpProfile, receive, respond } from "@sync-engine/boundary";
import { Frames } from "@sync-engine/internal/reads/frames";
import { assemble } from "@sync-engine/assembly";
import { httpFloor } from "@sync-engine/boundary";
import {
  checkGenerated,
  pinGenerated,
  renderGenerated,
  resolveApplication,
} from "@engine/tooling/generated-artifacts";
import { inspectAssembly } from "@engine/tooling/inspection";
import { PACKAGE_NAME, PACKAGE_VERSION } from "@engine/utils/package-version";

/**
 * A real config location — the packaged sample application — so the defaults
 * resolve against a project laid out the way the generator writes one.
 */
const configUrl = new URL("../../package/application/generated.config.ts", import.meta.url);
const languageModule = new URL("../../../src/language/index.ts", import.meta.url);

class SessioningConcept {
  start({ user }: { user: string }) {
    return { session: `session-${user}`, expiresAt: new Date(0) };
  }

  current({ session }: { session: string }) {
    return { user: session.slice("session-".length) };
  }
}

const vocabularyDeclaration = vocabulary({
  concepts: { Sessioning: SessioningConcept },
  computations: {},
});
const { Sessioning } = vocabularyDeclaration.concepts;

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
            vocabulary: { module: languageModule },
          },
          configUrl,
        ),
      )
    ).specification;

    expect(boundary?.actions.map(({ name }) => name)).toEqual(["request", "respond"]);
    expect(inspection.diagnostics.map(({ code }) => code)).not.toContain(
      "MISSING_ENDPOINT_FALLBACK",
    );
    expect(rendered).toContain("- `request (…)`");
    expect(rendered).toContain("- `respond (…)` — may refuse `NOT_PENDING`");
    expect(rendered).not.toMatch(/- `(register|cancel|respondFramework) /);
    expect(rendered).toContain("when RequestBoundary.request");
    expect(rendered).toContain("RequestBoundary.respond (");
  });

  test("the installed command prints exact, stackless help", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const expected = `Usage: sync-engine <topic> <command>

  sync-engine new <directory>
    Write a runnable project: one concept, its composition, and its config.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    manifest   Print the canonical application manifest as JSON.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

  sync-engine check [--concepts <path...>] [--config path] [--fail-on-warnings]
    Check parsed action/query declarations against class source and optionally inspect application diagnostics.
    Defaults to src/concepts.\n`;
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

  test("an HTTP floor emits logical and projected named contracts", async () => {
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
          vocabulary: { module: languageModule },
          httpFloor: httpFloor({
            origin: "http://localhost:3000",
            credential: {
              name: "session",
              input: "session",
              issue: { path: "/login", output: "session", expires: "expiresAt" },
              clear: [],
            },
          }),
        },
        configUrl,
      ),
    );

    expect(rendered.wire.match(/export type Json =/g)).toHaveLength(1);
    expect(rendered.wire).toContain("export type ApplicationWire = {");
    expect(rendered.wire).toContain('"session": Jsonify<');
    expect(rendered.wire).toContain("export type HttpAppWideError =");
    expect(rendered.wire).toContain("export type ApplicationWireHttp = {");
    const projected = rendered.wire.slice(rendered.wire.indexOf("ApplicationWireHttp"));
    expect(projected).not.toContain('"session":');
  });

  test("a production HTTP profile projects errors without consuming logical fields", async () => {
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
          vocabulary: { module: languageModule },
          httpProfile: productionHttpProfile({ origin: "https://example.test" }),
        },
        configUrl,
      ),
    );

    const projected = rendered.wire.slice(rendered.wire.indexOf("ApplicationWireHttp"));
    expect(projected).toContain('"session":');
    expect(projected).toContain('error: { error: HttpAppWideError | "INVALID_REQUEST" }');
  });

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
        vocabulary: { module: languageModule },
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
        vocabulary: { module: languageModule },
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
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: { Login } }),
        directory: pathToFileURL(`${generated}/`),
        specification: "%2e%2e/escape.md",
        title: "Unsafe path application",
        vocabulary: { module: languageModule },
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
  });

  test("selectively pins atomic files and detects missing or changed output", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-"));
    const generated = join(temporary, "generated");
    const directory = pathToFileURL(`${generated}/`);
    const application = resolveApplication(
      {
        assemble: () =>
          assemble({ vocabulary: vocabularyDeclaration, composition: { Login, Current } }),
        directory,
        title: "Filesystem application",
        vocabulary: { module: languageModule },
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
  });

  test("reports generated artifact filesystem failures without partial writes", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-generated-failure-"));
    const generated = join(temporary, "generated");
    const blocked = join(generated, "blocked.md");
    await mkdir(blocked, { recursive: true });
    const application = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: { Login } }),
        directory: pathToFileURL(`${generated}/`),
        specification: "blocked.md",
        title: "Blocked application",
        vocabulary: { module: languageModule },
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
  });

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
        vocabulary: { module: languageModule },
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
        vocabulary: { module: languageModule },
      },
      configUrl,
    );

    await expect(renderGenerated(application)).rejects.toThrow("assembly failed");
    expect(closed).toBe(true);
  });
});

describe("an artifact configuration's defaults", () => {
  test("a title and an assembly are enough", () => {
    const resolved = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
        title: "Reading circle",
      },
      configUrl,
    );
    expect({
      directory: resolved.directory.href,
      specification: resolved.specification,
      wire: resolved.wire,
      wireName: resolved.wireName,
      wireBanner: resolved.wireBanner,
      vocabularyFrom: resolved.vocabularyFrom,
    }).toEqual({
      directory: new URL("./generated/", configUrl).href,
      specification: "reading-circle.md",
      wire: "wire.ts",
      wireName: "ReadingCircleWire",
      wireBanner: undefined,
      vocabularyFrom: { from: "../src/concept-set.ts", export: "vocabulary" },
    });
  });

  test("explicit names, paths, and banners override the derived output", async () => {
    const resolved = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
        title: "Reading circle",
        specification: "book.md",
        specificationBanner: "<!-- Project specification -->",
        wireName: "CircleContracts",
        wireBanner: "// Project wire contract",
        vocabulary: { module: languageModule, export: "words" },
      },
      configUrl,
    );
    const rendered = await renderGenerated(resolved);
    expect(resolved.specification).toBe("book.md");
    expect(resolved.wireName).toBe("CircleContracts");
    expect(resolved.vocabularyFrom.export).toBe("words");
    expect(
      rendered.specification.startsWith(
        `<!-- Project specification -->\n<!-- Generator: ${PACKAGE_NAME}@${PACKAGE_VERSION}. -->`,
      ),
    ).toBe(true);
    expect(
      rendered.wire.startsWith(
        `// Project wire contract\n// Generator: ${PACKAGE_NAME}@${PACKAGE_VERSION}.`,
      ),
    ).toBe(true);
  });

  test("a vocabulary module that is not there fails by path", () => {
    expect(() =>
      resolveApplication(
        {
          assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
          title: "Reading circle",
          vocabulary: { module: new URL("./absent/concept-set.ts", import.meta.url) },
        },
        configUrl,
      ),
    ).toThrow(/no vocabulary module at .*absent[/\\]concept-set\.ts/);
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
