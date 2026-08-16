import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

const executables: Record<string, string> = {
  "@mit-sdg/sync-engine": "sync-engine",
  "@mit-sdg/sync-engine-analysis": "sync-engine-analysis",
  "@mit-sdg/sync-engine-catalog": "sync-engine-catalog",
};

async function writePackage(
  directory: string,
  name: string,
  version: string,
  executable = executables[name],
): Promise<void> {
  const target = resolve(directory, "node_modules", name);
  const binTarget = "./dist/command.js";
  await mkdir(resolve(target, "dist"), { recursive: true });
  await writeFile(
    resolve(target, "package.json"),
    JSON.stringify({
      name,
      version,
      bin: executable === undefined ? {} : { [executable]: binTarget },
    }),
  );
  await writeFile(resolve(target, binTarget), "#!/usr/bin/env node\n");
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sync-engine-skill command", () => {
  test("initializes the exact packaged brief template without replacing a brief", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-brief-init-"));
    temporary.push(directory);
    const path = resolve(directory, "design/brief.md");
    const initialized = run(["brief", "init", path], directory);
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toBe(
      "Brief template initialized. Fill placeholders before running brief check.\n",
    );
    const template = await readFile(
      resolve("packages/skill/skills/sync-engine/prompts/templates/product-brief.md"),
      "utf8",
    );
    expect(await readFile(path, "utf8")).toBe(template);
    const repeated = run(["brief", "init", path], directory);
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("Brief already exists");

    const filled = template
      .replace("<Product name>", "Product")
      .replace("<One short paragraph describing the useful outcome.>", "Deliver the product.")
      .replace(
        "- **D1 — <Decision title> (User):** <Decision and only the reason needed to understand it.>",
        "- **D1 — Scope (User):** Use one workspace.",
      )
      .replace("- <Externally observable successful behavior.>", "- A user completes the task.")
      .replace("- <Expected denied or rejected behavior.>", "- Invalid input is rejected.")
      .replace("- <Conservative assumption used to complete the design.>", "- Use local storage.")
      .replace("- <Behavior intentionally outside scope.>", "- Hosted deployment.");
    await writeFile(path, filled);
    const checked = run(["brief", "check", path], directory);
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("1 decisions, open decisions none");
  });

  test("validates a brief before an application release set is installed", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-bootstrap-"));
    temporary.push(directory);
    const result = run(["brief", "check", taskBrief], directory);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^Brief valid: \d+ bytes, 1 decisions, open decisions none; release 1\.0\.0-beta\.12\.\n$/,
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

  test("digests closed design and bounds diagnostic follow-ups", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-design-cli-"));
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design);
    await writeFile(resolve(design, "brief.md"), "# Brief\n");
    const digested = run(["design", "digest", design], directory);
    expect(digested.status).toBe(0);
    const digest = digested.stdout.match(/[a-f0-9]{64}/)?.[0];
    expect(digest).toBeDefined();

    const followUp = resolve(directory, "follow-up.md");
    await writeFile(followUp, "Run `bun run test`.\n");
    const checked = run(
      ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Follow-up valid");

    await writeFile(followUp, "x".repeat(4097));
    expect(
      run(
        ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
        directory,
      ).stderr,
    ).toContain("maximum is 4096");
  });

  test("checks an installed application against the embedded release", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-version-"));
    temporary.push(directory);
    for (const name of [
      "@mit-sdg/sync-engine",
      "@mit-sdg/sync-engine-analysis",
      "@mit-sdg/sync-engine-catalog",
    ]) {
      await writePackage(directory, name, "1.0.0-beta.12");
    }
    const valid = run(["release", "check", directory], directory);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toBe("Installed sync-engine release matches skill 1.0.0-beta.12.\n");

    await rm(resolve(directory, "node_modules/@mit-sdg/sync-engine-catalog/dist/command.js"));
    const missingTarget = run(["release", "check", directory], directory);
    expect(missingTarget.status).toBe(1);
    expect(missingTarget.stderr).toContain("has missing or escaping target");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.12");

    await writePackage(directory, "@mit-sdg/sync-engine", "0.0.0");
    const mixed = run(["release", "check", directory], directory);
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("does not match skill 1.0.0-beta.12");
    expect(mixed.stderr).toContain("@mit-sdg/sync-engine@0.0.0");

    await writePackage(directory, "@mit-sdg/sync-engine", "1.0.0-beta.12", "sync-engine");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.12", "catalog");
    const staleExecutable = run(["release", "check", directory], directory);
    expect(staleExecutable.status).toBe(1);
    expect(staleExecutable.stderr).toContain(
      "does not expose required executable sync-engine-catalog",
    );
  });

  test("does not accept an ancestor source package as an installed dependency", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-ancestor-"));
    temporary.push(directory);
    await mkdir(resolve(directory, "application"));
    await writeFile(
      resolve(directory, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine",
        version: "1.0.0-beta.12",
        bin: { "sync-engine": "./dist/command.js" },
      }),
    );
    await mkdir(resolve(directory, "dist"));
    await writeFile(resolve(directory, "dist/command.js"), "#!/usr/bin/env node\n");
    for (const name of ["@mit-sdg/sync-engine-analysis", "@mit-sdg/sync-engine-catalog"]) {
      await writePackage(resolve(directory, "application"), name, "1.0.0-beta.12");
    }

    const result = run(
      ["release", "check", resolve(directory, "application")],
      resolve(directory, "application"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve installed package @mit-sdg/sync-engine");
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
