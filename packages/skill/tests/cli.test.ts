import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "vite-plus/test";

const command = resolve("packages/skill/skills/sync-engine/scripts/command.ts");
const taskBrief = resolve("packages/skill/tests/fixtures/task-manager/brief.md");
const temporary: string[] = [];

/** Commands report native paths; assertions on path shape read them separator-free. */
function posixPaths(output: string): string {
  return output.replaceAll("\\", "/");
}

/** macOS resolves the temp root through a symlink; commands report the real path. */
async function temporaryDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(resolve(tmpdir(), prefix)));
}

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

async function writeConfiguredApplication(directory: string): Promise<void> {
  for (const name of Object.keys(executables)) {
    await writePackage(directory, name, "1.0.0-beta.13");
  }
  await Promise.all([
    writeFile(resolve(directory, "package.json"), '{"private":true,"type":"module"}\n'),
    writeFile(resolve(directory, "tsconfig.json"), "{}\n"),
    writeFile(resolve(directory, "generated.config.ts"), "export default {};\n"),
  ]);
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sync-engine-skill command", () => {
  test("requires setup before initializing the exact brief template", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-brief-init-");
    temporary.push(directory);
    const path = resolve(directory, "product/brief.md");
    const premature = run(["brief", "init", path], directory);
    expect(premature.status).toBe(1);
    expect(premature.stderr).toContain("Brief init requires completed sync-engine setup");
    expect(premature.stderr).toContain("release check .");
    expect(premature.stderr).toContain("bunx --no-install sync-engine setup");
    await expect(readFile(path, "utf8")).rejects.toThrow();

    for (const name of Object.keys(executables)) {
      await writePackage(directory, name, "1.0.0-beta.13");
    }
    const unconfigured = run(["brief", "init", path], directory);
    expect(unconfigured.status).toBe(1);
    expect(unconfigured.stderr).toContain("missing setup files");
    await expect(readFile(path, "utf8")).rejects.toThrow();

    await writeConfiguredApplication(directory);
    const initialized = run(["brief", "init", path], directory);
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toContain("Brief template initialized. Fill placeholders.\n");
    expect(initialized.stdout).toContain(
      `Next: bun "<skill-root>/scripts/command.ts" brief check ${path}\n`,
    );
    expect(initialized.stdout).not.toContain(dirname(command));
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
    expect(checked.stdout).toContain("Next: read ");
    expect(posixPaths(checked.stdout)).toContain("references/design-and-criticism.md\n");
    expect(checked.stdout).toContain(`prompt build --role designer --input brief=${path}`);
  });

  test("validates a brief before an application release set is installed", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-bootstrap-");
    temporary.push(directory);
    const result = run(["brief", "check", taskBrief], directory);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^Brief valid: \d+ bytes, 1 decisions, open decisions none; release 1\.0\.0-beta\.13\.\n/,
    );
    expect(result.stderr).toBe("");
  });

  test("writes prompt bytes into the workspace and reports sources separately", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-cli-");
    temporary.push(directory);
    const build = ["prompt", "build", "--role", "designer", "--input", `brief=${taskBrief}`];
    const first = run(build, directory);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toMatch(
      /Prompt built: role designer; \d+ bytes; budget 32768; sha256 [a-f0-9]{64}/,
    );

    const written = (await readdir(resolve(directory, ".sync-engine"))).sort();
    expect(written).toHaveLength(2);
    const [contextName, promptName] = written as [string, string];
    expect(promptName).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-designer\.prompt\.md$/);
    expect(contextName).toBe(promptName.replace(/\.md$/, ".json"));
    const recorded = JSON.parse(
      await readFile(resolve(directory, ".sync-engine", contextName), "utf8"),
    );
    expect(recorded.role).toBe("designer");
    expect(recorded.sha256).toBe(first.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1]);
    expect(recorded.briefSha256).toMatch(/^[a-f0-9]{64}$/);
    const output = resolve(directory, ".sync-engine", promptName);
    expect(first.stdout).toContain(`Next: deliver ${output} to a fresh designer as a file`);
    const prompt = await readFile(output, "utf8");
    expect(prompt).toContain("<!-- source: brief.md -->");
    expect(prompt).not.toContain(first.stdout);

    const second = run(build, directory);
    expect(second.status).toBe(0);
    expect(second.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1]).toBe(
      first.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1],
    );
    expect((await readdir(resolve(directory, ".sync-engine"))).length).toBe(4);
  });

  test("keeps generated workflow files out of the design root", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-placement-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await writeFile(resolve(product, "brief.md"), "# Brief\n");
    const strayAssignment = resolve(design, "assignment.md");
    await writeFile(strayAssignment, "Assignment.\n");

    const digested = run(["design", "digest", design], directory);
    const digest = digested.stdout.match(/[a-f0-9]{64}/)?.[0];
    const rejected = run(
      [
        "prompt",
        "build",
        "--role",
        "concept-worker",
        "--input",
        `assignment=${strayAssignment}`,
        "--input",
        `specifications=${resolve(product, "brief.md")}`,
        "--design-root",
        design,
        "--design-digest",
        digest!,
      ],
      directory,
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(".sync-engine/");

    const strayFollowUp = resolve(design, "follow-up.md");
    await writeFile(strayFollowUp, "Rerun the check.\n");
    const refused = run(
      ["follow-up", "check", strayFollowUp, "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Generated workflow files belong in .sync-engine/");
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
    expect(result.stdout).not.toContain("Next:");
    expect(result.stdout).not.toContain(".sync-engine");
    expect(result.stderr).toContain("Prompt built: role designer");
    expect(result.stderr).toContain("Next: deliver the built prompt to a fresh designer as a file");
  });

  test("digests closed design and bounds diagnostic follow-ups", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-design-cli-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design);
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const digested = run(["design", "digest", design], directory);
    expect(digested.status).toBe(0);
    const digest = digested.stdout.match(/[a-f0-9]{64}/)?.[0];
    expect(digest).toBeDefined();
    expect(posixPaths(digested.stdout)).toContain("references/implementation.md\n");
    expect(digested.stdout).toContain(
      `Next: every downstream build and follow-up adds --design-root ${design} --design-digest ${digest}`,
    );

    const followUp = resolve(directory, ".sync-engine", "repair.followup.md");
    await mkdir(resolve(directory, ".sync-engine"), { recursive: true });
    await writeFile(followUp, "Run `bun run test`.\n");
    const checked = run(
      ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Follow-up valid");
    expect(checked.stdout).toContain(`Next: deliver ${followUp} to the original role as a file`);

    await writeFile(followUp, "x".repeat(4097));
    expect(
      run(
        ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
        directory,
      ).stderr,
    ).toContain("maximum is 4096");
  });

  test("checks an installed application against the embedded release", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-version-");
    temporary.push(directory);
    for (const name of [
      "@mit-sdg/sync-engine",
      "@mit-sdg/sync-engine-analysis",
      "@mit-sdg/sync-engine-catalog",
    ]) {
      await writePackage(directory, name, "1.0.0-beta.13");
    }
    const valid = run(["release", "check", directory], directory);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("Installed sync-engine release matches skill 1.0.0-beta.13.\n");
    expect(valid.stdout).toContain("Next: bunx --no-install sync-engine setup\n");

    await rm(resolve(directory, "node_modules/@mit-sdg/sync-engine-catalog/dist/command.js"));
    const missingTarget = run(["release", "check", directory], directory);
    expect(missingTarget.status).toBe(1);
    expect(missingTarget.stderr).toContain("has missing or escaping target");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.13");

    await writePackage(directory, "@mit-sdg/sync-engine", "0.0.0");
    const mixed = run(["release", "check", directory], directory);
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("does not match skill 1.0.0-beta.13");
    expect(mixed.stderr).toContain("@mit-sdg/sync-engine@0.0.0");

    await writePackage(directory, "@mit-sdg/sync-engine", "1.0.0-beta.13", "sync-engine");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.13", "catalog");
    const staleExecutable = run(["release", "check", directory], directory);
    expect(staleExecutable.status).toBe(1);
    expect(staleExecutable.stderr).toContain(
      "does not expose required executable sync-engine-catalog",
    );
  });

  test("does not accept an ancestor source package as an installed dependency", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-ancestor-");
    temporary.push(directory);
    await mkdir(resolve(directory, "application"));
    await writeFile(
      resolve(directory, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine",
        version: "1.0.0-beta.13",
        bin: { "sync-engine": "./dist/command.js" },
      }),
    );
    await mkdir(resolve(directory, "dist"));
    await writeFile(resolve(directory, "dist/command.js"), "#!/usr/bin/env node\n");
    for (const name of ["@mit-sdg/sync-engine-analysis", "@mit-sdg/sync-engine-catalog"]) {
      await writePackage(resolve(directory, "application"), name, "1.0.0-beta.13");
    }

    const result = run(
      ["release", "check", resolve(directory, "application")],
      resolve(directory, "application"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve installed package @mit-sdg/sync-engine");
  });

  test("runs from a standalone copied skill without package installation", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-copy-");
    temporary.push(directory);
    const copiedSkill = resolve(directory, "sync-engine");
    await cp(resolve("packages/skill/skills/sync-engine"), copiedSkill, { recursive: true });
    const copiedCommand = resolve(copiedSkill, "scripts/command.ts");
    const result = run(
      ["prompt", "build", "--role", "designer", "--input", `brief=${taskBrief}`],
      directory,
      copiedCommand,
    );
    expect(result.status).toBe(0);
    const written = (await readdir(resolve(directory, ".sync-engine"))).sort();
    const output = resolve(directory, ".sync-engine", written[1]!);
    expect(await readFile(output, "utf8")).toContain("# Independent designer");
    expect(result.stdout).toContain(`Next: deliver ${output} to a fresh designer as a file`);
    expect(result.stdout).toContain(copiedSkill);
  });

  async function launchRecord(
    directory: string,
    role: string,
    options: {
      agentId?: string;
      promptBytes?: string;
      status?: string;
      designDigest?: string;
    } = {},
  ): Promise<string> {
    const workspace = resolve(directory, ".sync-engine");
    await mkdir(workspace, { recursive: true });
    const promptPath = resolve(workspace, `2026-01-01T00-00-00Z-${role}.prompt.md`);
    const content = options.promptBytes ?? `# ${role}\n`;
    await writeFile(promptPath, content);
    const record = {
      format: "sync-engine.skill.launch-record",
      version: 1,
      role,
      agentId: options.agentId ?? `agent-${role}`,
      provider: "paseo-test",
      model: "test-model",
      cwd: directory,
      prompt: {
        path: promptPath,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: Buffer.byteLength(content, "utf8"),
      },
      ...(options.designDigest === undefined ? {} : { designDigest: options.designDigest }),
      startedAt: "2026-01-01T00:00:00.000Z",
      settledAt: "2026-01-01T00:05:00.000Z",
      status: options.status ?? "idle",
    };
    const recordPath = resolve(workspace, `2026-01-01T00-05-00Z-${role}.launch.json`);
    await writeFile(recordPath, `${JSON.stringify(record, undefined, 2)}\n`);
    return recordPath;
  }

  test("builds a later role only after its predecessor actually ran", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-chain-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");

    const criticArguments = [
      "prompt",
      "build",
      "--role",
      "critic",
      "--input",
      `brief=${resolve(product, "brief.md")}`,
      "--input",
      `candidate=${resolve(design, "types.md")}`,
    ];
    const ungated = run(criticArguments, directory);
    expect(ungated.status).toBe(1);
    expect(ungated.stderr).toContain("Role critic requires a settled designer launch");

    await launchRecord(directory, "designer");
    const gated = run(criticArguments, directory);
    expect(gated.status).toBe(0);
    expect(gated.stdout).toContain("Prompt built: role critic");
  });

  test("stops counting a role once design reopens under it", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-reopened-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const reviewed = "b".repeat(64);
    await launchRecord(directory, "critic", { designDigest: reviewed });
    const assignment = resolve(
      directory,
      ".sync-engine",
      "2026-01-01T00-06-00Z-concept-worker.assignment.md",
    );
    await writeFile(assignment, "# concept-worker assignment\n");

    const build = (digest: string) =>
      run(
        [
          "prompt",
          "build",
          "--role",
          "concept-worker",
          "--input",
          `assignment=${assignment}`,
          "--input",
          `specifications=${resolve(design, "types.md")}`,
          "--input",
          `examples=${resolve(design, "types.md")}`,
          "--design-root",
          design,
          "--design-digest",
          digest,
        ],
        directory,
      );

    const reopened = build("c".repeat(64));
    expect(reopened.status).toBe(1);
    expect(reopened.stderr).toContain("Design reopened after that role ran, so relaunch it");
  });

  test("treats a role that never settled as not having run", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-unsettled-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    await launchRecord(directory, "designer", { status: "running" });

    const result = run(
      [
        "prompt",
        "build",
        "--role",
        "critic",
        "--input",
        `brief=${resolve(product, "brief.md")}`,
        "--input",
        `candidate=${resolve(design, "types.md")}`,
      ],
      directory,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Role critic requires a settled designer launch");
  });

  test("refuses a launch record whose prompt no longer matches", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-tamper-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    await launchRecord(directory, "designer");
    await writeFile(
      resolve(directory, ".sync-engine", "2026-01-01T00-00-00Z-designer.prompt.md"),
      "# replaced after the fact\n",
    );

    const result = run(
      [
        "prompt",
        "build",
        "--role",
        "critic",
        "--input",
        `brief=${resolve(product, "brief.md")}`,
        "--input",
        `candidate=${resolve(design, "types.md")}`,
      ],
      directory,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Role critic requires a settled designer launch");
  });

  test("handback names every role that has no independent evidence", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-handback-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const digest = run(["design", "digest", design], directory).stdout.match(/[a-f0-9]{64}/)?.[0];

    const empty = run(
      ["handback", "check", "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain(
      "no settled launch for: designer, critic, concept-worker, application-worker, evidence-worker",
    );

    await launchRecord(directory, "designer", { agentId: "invented-agent-id" });
    const invented = run(
      ["handback", "check", "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(invented.status).toBe(1);
    expect(invented.stdout).toContain("agent invented-agent-id UNKNOWN to paseo");
    expect(invented.stderr).toContain("paseo does not know: designer invented-agent-id");
  });

  test("refuses an assignment that crosses role ownership", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-assignment-");
    temporary.push(directory);
    const started = run(
      ["assignment", "new", "--role", "concept-worker", "--design-digest", "a".repeat(64)],
      directory,
    );
    expect(started.status).toBe(0);
    const path = started.stdout.match(/Assignment started: (\S+)/)?.[1];
    expect(dirname(path!)).toBe(resolve(directory, ".sync-engine"));
    expect(basename(path!)).toMatch(/^\d{4}-.*-concept-worker\.assignment\.md$/);

    const complete = `# concept-worker assignment

## Storage guarantee

In-memory only; nothing survives restart, per the brief's demo decision.

## Allowed write paths

- \`src/concepts/Shortening.ts\`
- \`tests/concepts/Shortening.test.ts\`

## Commands

- \`bun test tests/concepts/\`
- \`tsc --noEmit\`
`;
    await writeFile(path!, complete);
    expect(run(["assignment", "check", path!], directory).status).toBe(0);

    await writeFile(
      path!,
      complete.replace(
        "- `tests/concepts/Shortening.test.ts`",
        "- `tests/concepts/Shortening.test.ts`\n- `src/concepts/Shortening.registry.ts`",
      ),
    );
    const crossed = run(["assignment", "check", path!], directory);
    expect(crossed.status).toBe(1);
    expect(crossed.stderr).toContain(
      "Assignment gives concept-worker a path owned by the application worker: src/concepts/Shortening.registry.ts",
    );

    await writeFile(
      path!,
      complete.replace("- `tsc --noEmit`", "- `bunx --no-install sync-engine check`"),
    );
    const wide = run(["assignment", "check", path!], directory);
    expect(wide.status).toBe(1);
    expect(wide.stderr).toContain("application-wide command `sync-engine check`");

    await writeFile(
      path!,
      complete.replace(/## Storage guarantee[\s\S]*?## Allowed/, "## Allowed"),
    );
    const unstated = run(["assignment", "check", path!], directory);
    expect(unstated.status).toBe(1);
    expect(unstated.stderr).toContain("Assignment states no storage guarantee");

    await writeFile(
      path!,
      complete.replace(
        "## Allowed write paths",
        `## Allowed read paths

- \`node_modules/@mit-sdg/sync-engine/examples/message-board/src/concepts/Posting.registry.ts\`

## Allowed write paths`,
      ),
    );
    expect(run(["assignment", "check", path!], directory).status).toBe(0);
  });

  test("names follow-up files itself", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-followup-");
    temporary.push(directory);
    const started = run(["follow-up", "new", "--role", "concept-worker"], directory);
    expect(started.status).toBe(0);
    const path = started.stdout.match(/Follow-up started: (\S+)/)?.[1];
    expect(dirname(path!)).toBe(resolve(directory, ".sync-engine"));
    expect(basename(path!)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-concept-worker\.followup\.md$/);
    expect(await readFile(path!, "utf8")).toBe("");

    const second = run(["follow-up", "new", "--role", "concept-worker"], directory);
    expect(second.status).toBe(0);
    expect(second.stdout.match(/Follow-up started: (\S+)/)?.[1]).not.toBe(path);

    expect(run(["follow-up", "new", "--role", "designer-2"], directory).status).toBe(1);
  });

  test("launches only through the harness and only from the workspace", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-launch-");
    temporary.push(directory);
    const stray = resolve(directory, "designer.prompt.md");
    await writeFile(stray, "# designer\n");
    const outside = run(["launch", "--role", "designer", "--prompt", stray], directory);
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("Generated workflow files belong in .sync-engine/");

    await mkdir(resolve(directory, ".sync-engine"), { recursive: true });
    const inside = resolve(directory, ".sync-engine", "designer.prompt.md");
    await writeFile(inside, "# designer\n");
    const unparented = spawnSync(
      "bun",
      [command, "launch", "--role", "designer", "--prompt", inside],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, PASEO_AGENT_ID: "" },
      },
    );
    expect(unparented.status).toBe(1);
    expect(unparented.stderr).toContain("PASEO_AGENT_ID is unset");

    const unknownRole = run(["launch", "--role", "reviewer", "--prompt", inside], directory);
    expect(unknownRole.status).toBe(1);
    expect(unknownRole.stderr).toContain("Unknown role: reviewer");
  });

  test("reports concise usage and argument failures", () => {
    expect(run(["--help"]).stdout).toContain("sync-engine-skill prompt build");
    const missing = run(["prompt", "build"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("prompt build requires --role");
  });
});
