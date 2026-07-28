import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { reaction, vocabulary, when } from "@sync-engine/language";
import { endpoint, productionHttpProfile, receive, respond } from "@sync-engine/boundary";
import { Frames } from "@sync-engine/internal/reads/frames";
import { assemble } from "@sync-engine/assembly";
import { httpFloor } from "@sync-engine/boundary";
import {
  checkGenerated,
  pinGenerated,
  renderGenerated,
  resolveApplication,
} from "../../../src/engine/tooling/generated-artifacts.ts";
import { inspectAssembly } from "../../../src/engine/tooling/inspection.ts";

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

const InternalClosure = reaction(({ hidden, user }) =>
  when(Sessioning.start({ user }).responds())
    .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "kept" })))
    .then(Sessioning.current({ session: "fixed" }).responds())
    .then(Sessioning.start({ user: hidden }).responds()),
);

describe("generated application artifacts", () => {
  test("the request boundary inventory contains only author-facing actions", () => {
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Login },
    });
    const boundary = inspectAssembly(application).concepts.find(
      ({ name }) => name === "RequestBoundary",
    );
    const rendered = renderGenerated(
      resolveApplication(
        {
          assemble: () => application,
          directory: new URL("./generated/", import.meta.url),
          title: "Application",
          vocabulary: { module: languageModule },
        },
        configUrl,
      ),
    ).specification;

    expect(boundary?.actions.map(({ name }) => name)).toEqual(["request", "respond"]);
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
    Verify concept specifications and optionally inspect application diagnostics.
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

  test("an HTTP floor emits logical and projected named contracts", () => {
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Login, Current },
    });
    const rendered = renderGenerated(
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

  test("a production HTTP profile projects errors without consuming logical fields", () => {
    const application = assemble({
      vocabulary: vocabularyDeclaration,
      composition: { Login, Current },
    });
    const rendered = renderGenerated(
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
      'endpoint "Api.ClosureEndpoint" at "/closure" (reaction "Api.ClosureEndpoint"): ' +
      "step 2 needs a value bound by a closure where";

    expect(() => renderGenerated(application)).toThrow(message);
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
    expect(result.stderr).toContain(
      'endpoint "Api.ClosureEndpoint" at "/closure" (reaction "Api.ClosureEndpoint")',
    );
    expect(result.stderr).toContain("step 2 needs a value bound by a closure where");
  });

  test("an ordinary unlowered internal reaction remains visible in read-back", () => {
    const rendered = renderGenerated(
      resolveApplication(
        {
          assemble: () =>
            assemble({
              vocabulary: vocabularyDeclaration,
              composition: { InternalClosure },
            }),
          directory: new URL("./generated/", import.meta.url),
          title: "Internal application",
          vocabulary: { module: languageModule },
        },
        configUrl,
      ),
    );

    expect(rendered.metrics.unlowered).toEqual([
      { name: "InternalClosure", reason: "step 2 needs a value bound by a closure where" },
    ]);
    expect(rendered.specification).toContain("## Reactions represented only by executable code");
    expect(rendered.specification).toContain(
      "`InternalClosure` — step 2 needs a value bound by a closure where",
    );
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
      wireBanner: "// Generated by sync-engine from the Reading circle assembly. Do not edit.",
      vocabularyFrom: { from: "../src/concept-set.ts", export: "vocabulary" },
    });
  });

  test("an explicit name and path override the derived ones", () => {
    const resolved = resolveApplication(
      {
        assemble: () => assemble({ vocabulary: vocabularyDeclaration, composition: {} }),
        title: "Reading circle",
        specification: "book.md",
        wireName: "CircleContracts",
        vocabulary: { module: languageModule, export: "words" },
      },
      configUrl,
    );
    expect(resolved.specification).toBe("book.md");
    expect(resolved.wireName).toBe("CircleContracts");
    expect(resolved.vocabularyFrom.export).toBe("words");
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
});
