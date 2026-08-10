import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../../", import.meta.url);
const documents = {
  readme: new URL("README.md", root),
  semantics: new URL("docs/user/reference/semantics.md", root),
  publicSurface: new URL("docs/user/reference/public-api.md", root),
};

function codeBlocks(markdown: string, language: string): string[] {
  return [...markdown.matchAll(/^(`{3,})([^\n]*)\n([\s\S]*?)\n\1$/gm)]
    .filter((match) => match[2].trim() === language)
    .map((match) => match[3]);
}

function syntaxDiagnostics(source: string): string[] {
  return (
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
      fileName: "documented-example.ts",
      reportDiagnostics: true,
    }).diagnostics ?? []
  ).map(
    (diagnostic) =>
      `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
  );
}

function shellLines(markdown: string): string[] {
  return codeBlocks(markdown, "sh").flatMap((block) =>
    block
      .split("\n")
      .map((line) => line.replace(/\s+#.*$/, "").trim())
      .filter(Boolean),
  );
}

async function json(path: string): Promise<{
  name?: string;
  publishConfig?: { tag?: string };
  scripts?: Record<string, string>;
}> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as {
    name?: string;
    publishConfig?: { tag?: string };
    scripts?: Record<string, string>;
  };
}

describe("executable documentation examples", () => {
  test("TypeScript fences in the overview and references remain syntactically valid", async () => {
    const readme = await readFile(documents.readme, "utf8");
    for (const block of codeBlocks(readme, "ts")) {
      expect(syntaxDiagnostics(block), block.slice(0, 80)).toEqual([]);
    }

    const semantics = await readFile(documents.semantics, "utf8");
    for (const block of codeBlocks(semantics, "ts")) {
      expect(syntaxDiagnostics(`const documented = chain\n${block};`), block.slice(0, 80)).toEqual(
        [],
      );
    }

    const publicSurface = await readFile(documents.publicSurface, "utf8");
    for (const block of codeBlocks(publicSurface, "ts")) {
      const signatures = block.replace(/^invoker\./gm, "");
      expect(
        syntaxDiagnostics(`interface DocumentedSignatures {\n${signatures}\n}`),
        block.slice(0, 80),
      ).toEqual([]);
    }
  });

  test("documented Bun scripts exist in the package that owns each command", async () => {
    const contexts = [
      [documents.readme, [await json("package.json")]],
      [
        new URL("docs/user/guide/getting-started.md", root),
        [
          {
            scripts: {
              generate: "sync-engine artifacts pin",
              check: "...",
              start: "bun src/main.ts",
              test: "vp test",
            },
          },
        ],
      ],
      [
        new URL("docs/user/guide/authoring.md", root),
        [await json("package.json"), await json("examples/operations-room/package.json")],
      ],
    ] as const;

    for (const [document, manifests] of contexts) {
      const markdown = await readFile(document, "utf8");
      for (const line of shellLines(markdown)) {
        const script = line.match(/^bun run ([\w:-]+)/)?.[1];
        if (script !== undefined) {
          expect(
            manifests.some((manifest) => Object.hasOwn(manifest.scripts ?? {}, script)),
            `${document.pathname}: ${line}`,
          ).toBe(true);
        }
      }
    }
  });

  test("the package-qualified first-run command works through the local CLI", async () => {
    const readme = await readFile(documents.readme, "utf8");
    const manifest = await json("package.json");
    const command = shellLines(readme).find((line) => line.includes(" sync-engine setup"));
    expect(command).toBeDefined();

    const words = command?.split(/\s+/) ?? [];
    const executable = words.indexOf("sync-engine");
    expect(words.slice(0, executable)).toEqual([
      "bunx",
      "--package",
      `${manifest.name}@${manifest.publishConfig?.tag}`,
    ]);
    expect(words.slice(executable + 1)).toEqual(["setup"]);

    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-docs-"));
    const project = join(temporary, "workshop-app");
    try {
      await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
        await mkdir(project);
        await writeFile(
          join(project, "package.json"),
          '{"name":"workshop-app","packageManager":"bun@1.3.14"}\n',
        );
      });
      const result = spawnSync(
        "bun",
        [fileURLToPath(new URL("src/command/main.ts", root)), "setup"],
        { cwd: project, encoding: "utf8" },
      );
      expect({ status: result.status, stderr: result.stderr }, result.stdout).toEqual({
        status: 0,
        stderr: "",
      });
      await expect(readFile(join(project, "generated.config.ts"), "utf8")).resolves.toContain(
        'title: "Application"',
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("the documented artifact script is backed by a passing local artifact check", async () => {
    const guide = await readFile(new URL("docs/user/guide/authoring.md", root), "utf8");
    const manifest = await json("examples/operations-room/package.json");
    const command = shellLines(guide).find((line) => line.startsWith("bun run artifacts:"));
    const scriptName = command?.match(/^bun run ([\w:-]+)$/)?.[1];
    expect(scriptName).toBeDefined();

    const script = scriptName === undefined ? undefined : manifest.scripts?.[scriptName];
    expect(script).toMatch(/^sync-engine artifacts pin --config \S+$/);
    const config = script?.match(/--config (\S+)$/)?.[1];
    expect(config).toBeDefined();
    if (config === undefined) throw new Error("documented artifact script has no config");

    const result = spawnSync(
      "bun",
      [
        fileURLToPath(new URL("src/command/main.ts", root)),
        "artifacts",
        "check",
        "--config",
        fileURLToPath(new URL(`examples/operations-room/${config}`, root)),
      ],
      { cwd: fileURLToPath(root), encoding: "utf8" },
    );
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: "",
      stderr: "",
    });
  }, 15_000);
});
