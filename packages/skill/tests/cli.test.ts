import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vite-plus/test";

const command = resolve("packages/skill/skills/sync-engine/scripts/command.ts");
const taskBrief = resolve("packages/skill/tests/fixtures/task-manager/brief.md");
const temporary: string[] = [];

function run(args: readonly string[], cwd = process.cwd(), executable = command) {
  return spawnSync("bun", [executable, ...args], { cwd, encoding: "utf8" });
}

async function writePackage(directory: string, name: string, version: string): Promise<void> {
  const target = resolve(directory, "node_modules", name);
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, "package.json"), JSON.stringify({ name, version }));
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sync-engine-skill command", () => {
  test("validates a brief before an application release set is installed", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-bootstrap-"));
    temporary.push(directory);
    const result = run(["brief", "check", taskBrief], directory);
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

  test("checks an installed application against the embedded release", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-version-"));
    temporary.push(directory);
    for (const name of [
      "@mit-sdg/sync-engine",
      "@mit-sdg/sync-engine-analysis",
      "@mit-sdg/sync-engine-catalog",
    ]) {
      await writePackage(directory, name, "1.0.0-beta.11");
    }
    const valid = run(["release", "check", directory], directory);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toBe("Installed sync-engine release matches skill 1.0.0-beta.11.\n");

    await writePackage(directory, "@mit-sdg/sync-engine", "0.0.0");
    const mixed = run(["release", "check", directory], directory);
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("does not match skill 1.0.0-beta.11");
    expect(mixed.stderr).toContain("@mit-sdg/sync-engine@0.0.0");
  });

  test("runs from a standalone copied skill without package installation", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-copy-"));
    temporary.push(directory);
    const copiedSkill = resolve(directory, "sync-engine");
    await cp(resolve("packages/skill/skills/sync-engine"), copiedSkill, { recursive: true });
    const copiedCommand = resolve(copiedSkill, "scripts/command.ts");
    const output = resolve(directory, "designer.md");
    const result = run(
      [
        "prompt",
        "build",
        "--role",
        "designer",
        "--input",
        `brief=${taskBrief}`,
        "--output",
        output,
      ],
      directory,
      copiedCommand,
    );
    expect(result.status).toBe(0);
    expect(await readFile(output, "utf8")).toContain("# Independent designer");
  });

  test("reports concise usage and argument failures", () => {
    expect(run(["--help"]).stdout).toContain("sync-engine-skill prompt build");
    const missing = run(["prompt", "build", "--role", "designer"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("exactly one of --output or --stdout");
  });
});
