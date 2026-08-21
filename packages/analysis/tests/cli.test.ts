import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { analysisCliUsage, runAnalysisCli } from "../src/cli.ts";
import { applicationProjectFixture, projectManifest } from "./application-project-fixture.ts";

function output() {
  let text = "";
  return {
    writeOut(value: string) {
      text += value;
    },
    text: () => text,
  };
}

async function run(
  args: readonly string[],
  root: string,
  manifest = projectManifest(),
): Promise<string> {
  const captured = output();
  await runAnalysisCli(args, {
    cwd: root,
    loadManifest: async () => manifest,
    writeOut: captured.writeOut,
  });
  return captured.text();
}

describe("analysis CLI", () => {
  const fixtures: Array<ReturnType<typeof applicationProjectFixture>> = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
  });

  test("renders deterministic concise summary, search, describe, and impact from a real manifest", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const summary = await run(["summary"], fixture.root, fixture.manifest);
    expect(summary).toBe(await run(["summary"], fixture.root, fixture.manifest));
    expect(summary).toContain("# Application summary\n\nDesign elements:");
    expect(summary.length).toBeLessThan(1_000);

    const search = await run(["search", "Notes", "--limit", "2"], fixture.root, fixture.manifest);
    expect(search).toContain("`concept:Notes`");
    expect(search.length).toBeLessThan(2_000);

    const described = await run(["describe", "action:Notes.add"], fixture.root, fixture.manifest);
    expect(described).toContain("# Describe action:Notes.add");
    expect(described).toContain('"kind": "action"');

    const impact = await run(
      ["impact", "action:Notes.add", "--limit", "10"],
      fixture.root,
      fixture.manifest,
    );
    expect(impact).toContain("# Possible impact from action:Notes.add");
    expect(impact).toContain("reaction:RecordNote");
    expect(impact).toContain("Complete:");
  });

  test("discovers the installed core command from a nested project directory", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const core = join(fixture.root, "node_modules/@mit-sdg/sync-engine");
    const nested = join(fixture.root, "nested/project");
    mkdirSync(core, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(core, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine",
        type: "module",
        bin: { "sync-engine": "fake.mjs" },
      }),
    );
    writeFileSync(
      join(core, "fake.mjs"),
      `#!/usr/bin/env bun\nif (process.versions.bun === undefined) throw new Error("core command did not use Bun");\nprocess.stdout.write(${JSON.stringify(JSON.stringify(fixture.manifest))});\n`,
    );

    const captured = output();
    await runAnalysisCli(["summary"], { cwd: nested, writeOut: captured.writeOut });
    expect(captured.text()).toContain("# Application summary");
  });

  test("keeps manifest-only commands independent of project analysis", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const loader = vi.fn(async () => fixture.manifest);
    await runAnalysisCli(["summary"], { cwd: fixture.root, loadManifest: loader, writeOut() {} });
    expect(loader).toHaveBeenCalledOnce();
    // The project fixture deliberately contains a TypeScript error. Manifest diagnostics remain
    // independent and therefore do not report that project error.
    expect(await run(["diagnostics", "--limit", "20"], fixture.root, fixture.manifest)).toContain(
      "typescript/2322",
    );
    expect(await run(["summary"], fixture.root, fixture.manifest)).not.toContain("2322");
    // Runs the TypeScript compiler over the project fixture; slower CI hosts exceed 5s.
  }, 20_000);

  test("returns precise source locations and explicit source incompleteness", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const source = await run(
      ["sources", "reaction:RecordNote", "--limit", "10"],
      fixture.root,
      fixture.manifest,
    );
    expect(source).toMatch(/app\/src\/app\.ts:\d+:\d+-\d+:\d+/);
    expect(source).toContain("Attribution: attributed; query complete: true");

    writeFileSync(join(fixture.root, "tsconfig.json"), '{"files":[]}\n');
    const unresolved = await run(
      ["sources", "concept:Notes", "--limit", "10"],
      fixture.root,
      fixture.manifest,
    );
    expect(unresolved).toContain("Attribution: unavailable");
    // Same TypeScript compiler cost as the manifest-independence case above.
  }, 20_000);

  test("emits bounded valid JSON with paging metadata", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const text = await run(
      ["search", "Notes", "--json", "--limit", "1", "--offset", "0"],
      fixture.root,
      fixture.manifest,
    );
    const value = JSON.parse(text) as { items: unknown[]; nextOffset: number | null };
    expect(value.items).toHaveLength(1);
    expect(value.nextOffset === null || value.nextOffset > 0).toBe(true);
    expect(text.length).toBeLessThan(10_000);
  });

  test.each([
    ["unknown"],
    ["summary", "extra"],
    ["search"],
    ["describe", "bad-ref"],
    ["describe", "action:MissingDot"],
    ["impact", "unknown:thing"],
    ["summary", "--limit", "0"],
    ["summary", "--limit", "101"],
    ["summary", "--wat"],
    ["summary", "--json", "--json"],
  ])("rejects malformed arguments: %j", async (...args) => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    await expect(
      runAnalysisCli(args, { cwd: fixture.root, loadManifest: async () => fixture.manifest }),
    ).rejects.toThrow();
  });

  test("reports manifest/config acquisition failures without writing stdout", async () => {
    const fixture = applicationProjectFixture();
    fixtures.push(fixture);
    writeFileSync(join(fixture.root, "generated.config.ts"), "export {};\n");
    const captured = output();
    await expect(
      runAnalysisCli(["summary"], {
        cwd: fixture.root,
        loadManifest: async () => {
          throw new Error("invalid configured application");
        },
        writeOut: captured.writeOut,
      }),
    ).rejects.toThrow("invalid configured application");
    expect(captured.text()).toBe("");
  });

  test("prints obvious help", async () => {
    const captured = output();
    await runAnalysisCli(["--help"], { writeOut: captured.writeOut });
    expect(captured.text()).toBe(`${analysisCliUsage}\n`);
    expect(captured.text()).toContain(
      "--design-base <path>            Base for manifest design paths (default: generated)",
    );
  });
});
