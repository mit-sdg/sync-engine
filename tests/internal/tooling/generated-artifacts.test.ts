import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { request, vocabulary } from "@sync-engine/internal/reactions";
import { endpoint, receive, respond } from "@sync-engine/internal/boundary";
import { assemble } from "@sync-engine/assembly";
import { httpFloor } from "@sync-engine/boundary";
import { renderGenerated } from "../../../src/internal/tooling/generated-artifacts.ts";

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
    const expected = `Usage: sync-engine artifacts <command> [--config path]

Commands:
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
    const rendered = renderGenerated({
      assemble: () => application,
      directory: new URL("./generated/", import.meta.url),
      specification: "application.md",
      title: "Application",
      wire: "wire.ts",
      wireName: "ApplicationWire",
      wireVocabulary: { from: "./vocabulary.ts", export: "vocabulary" },
      httpFloor: httpFloor({
        origin: "http://localhost:3000",
        credential: {
          name: "session",
          input: "session",
          issue: { path: "/login", output: "session", expires: "expiresAt" },
          clear: [],
        },
      }),
    });

    expect(rendered.wire.match(/export type Json =/g)).toHaveLength(1);
    expect(rendered.wire).toContain("export type ApplicationWire = {");
    expect(rendered.wire).toContain('"session": Jsonify<');
    expect(rendered.wire).toContain("export type HttpAppWideError =");
    expect(rendered.wire).toContain("export type ApplicationWireHttp = {");
    const projected = rendered.wire.slice(rendered.wire.indexOf("ApplicationWireHttp"));
    expect(projected).not.toContain('"session":');
  });
});
