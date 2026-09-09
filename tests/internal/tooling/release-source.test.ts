import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

const root = resolve(import.meta.dirname, "../../..");
let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(resolve(tmpdir(), "sync-engine-release-source-"));
  mkdirSync(resolve(fixture, "scripts"));
  for (const name of ["check-release-source.ts", "workspaces.ts"]) {
    copyFileSync(resolve(root, "scripts", name), resolve(fixture, "scripts", name));
  }
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

function preflight(version: string): string {
  writeFileSync(resolve(fixture, "package.json"), JSON.stringify({ type: "module", version }));
  // A deliberately wrong tag stops accepted versions before any git or registry access.
  const result = spawnSync(
    process.execPath,
    [resolve(fixture, "scripts/check-release-source.ts")],
    {
      cwd: fixture,
      env: { ...process.env, GITHUB_REF_NAME: "not-a-release-tag" },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  return result.stderr;
}

describe("dependency-free publication source preflight", () => {
  test.each(["1.0.0", "1.0.1", "1.2.3", "1.9007199254740991.0"])(
    "accepts stable %s and then requires exact tag equality",
    (version) => {
      expect(preflight(version)).toContain(`expected tag v${version}; received not-a-release-tag`);
    },
  );

  test.each([
    "1.0.0-beta.16",
    "1.0.0-rc.1",
    "1.0.0+build.1",
    "v1.0.0",
    "1.0.0\n",
    "1.0.0\r\n",
    "1.0.0 ",
    " 1.0.0",
    "1.0",
    "1.01.0",
    "1.0.01",
    "1.9007199254740992.0",
    "1.0.9007199254740992",
    "0.3.0",
    "2.0.0",
  ])("rejects %s before any privileged publication work", (version) => {
    expect(preflight(version)).toContain(
      "version must be a canonical stable 1.MINOR.PATCH version",
    );
  });
});
