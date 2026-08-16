import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vite-plus/test";

const command = resolve("packages/skill/src/command.ts");
const taskBrief = resolve("packages/skill/tests/fixtures/task-manager/brief.md");
const temporary: string[] = [];

function run(args: readonly string[], cwd = process.cwd()) {
  return spawnSync("bun", [command, ...args], { cwd, encoding: "utf8" });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sync-engine-skill command", () => {
  test("validates a brief against the exact installed release set", () => {
    const result = run(["brief", "check", taskBrief]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^Brief valid: \d+ bytes, 1 decisions, open decisions none; release 1\.0\.0-beta\.11\.\n$/,
    );
    expect(result.stderr).toBe("");
  });

  test("writes prompt bytes to a file and reports sources and digest separately", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-cli-"));
    temporary.push(directory);
    const output = resolve(directory, "designer.md");
    const first = run([
      "prompt",
      "build",
      "--role",
      "designer",
      "--input",
      `brief=${taskBrief}`,
      "--output",
      output,
    ]);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toMatch(
      /Prompt built: role designer; \d+ bytes; budget 32768; sha256 [a-f0-9]{64}/,
    );
    const prompt = await readFile(output, "utf8");
    expect(prompt).toContain("<!-- source: brief.md -->");
    expect(prompt).not.toContain(first.stdout);

    const second = run([
      "prompt",
      "build",
      "--role",
      "designer",
      "--input",
      `brief=${taskBrief}`,
      "--output",
      output,
    ]);
    expect(second.status).toBe(0);
    expect(second.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1]).toBe(
      first.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1],
    );
  });

  test("keeps stdout prompt bytes separate from the stderr report", () => {
    const result = run([
      "prompt",
      "build",
      "--role",
      "designer",
      "--input",
      `brief=${taskBrief}`,
      "--stdout",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Independent designer");
    expect(result.stdout).toContain("# Shared task manager");
    expect(result.stdout).not.toContain("Prompt built:");
    expect(result.stderr).toContain("Prompt built: role designer");
  });

  test("rejects a mixed core version before reading command inputs", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-version-"));
    temporary.push(directory);
    const fake = resolve(directory, "node_modules/@mit-sdg/sync-engine");
    await mkdir(fake, { recursive: true });
    await writeFile(
      resolve(fake, "package.json"),
      JSON.stringify({ name: "@mit-sdg/sync-engine", version: "0.0.0" }),
    );
    const result = run(["brief", "check", "missing.md"], directory);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Installed sync-engine release versions do not match");
    expect(result.stderr).toContain("@mit-sdg/sync-engine@0.0.0");
    expect(result.stderr).not.toContain("ENOENT");
  });

  test("reports concise usage and argument failures", () => {
    expect(run(["--help"]).stdout).toContain("sync-engine-skill prompt build");
    const missing = run(["prompt", "build", "--role", "designer"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("exactly one of --output or --stdout");
  });
});
