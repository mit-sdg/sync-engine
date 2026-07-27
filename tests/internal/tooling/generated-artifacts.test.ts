import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { request, vocabulary } from "@sync-engine/internal/reactions";
import { endpoint, receive, respond } from "@sync-engine/internal/boundary";
import { assemble } from "@sync-engine/assembly";
import { httpFloor } from "@sync-engine/boundary";
import {
  renderGenerated,
  resolveApplication,
} from "../../../src/engine/tooling/generated-artifacts.ts";

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
      .then(request(Sessioning.start, { user }, { session, expiresAt }))
      .then(respond({ session, expiresAt })),
  { input: { required: ["user"] } },
);

const Current = endpoint(
  "/current",
  ({ session, user }) =>
    receive({ session })
      .then(request(Sessioning.current, { session }, { user }))
      .then(respond({ user })),
  { input: { required: ["session"] } },
);

describe("generated application artifacts", () => {
  test("the installed command prints exact, stackless artifact help", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const expected = `Usage: sync-engine <topic> <command>

  sync-engine new <directory>
    Write a runnable project: one concept, its composition, and its config.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

The configuration path defaults to generated.config.ts.\n`;
    const help = spawnSync("bun", ["src/command/artifacts.ts", "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    expect({ status: help.status, stdout: help.stdout, stderr: help.stderr }).toEqual({
      status: 0,
      stdout: expected,
      stderr: "",
    });

    const unknown = spawnSync("bun", ["src/command/artifacts.ts", "unknown"], {
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
    ).toThrow(/no vocabulary module at .*absent\/concept-set\.ts/);
  });

  test("a configuration without a title fails", () => {
    expect(() => resolveApplication({ title: "" } as never, configUrl)).toThrow(
      "title must name the application",
    );
  });
});
