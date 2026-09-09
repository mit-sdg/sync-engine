import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { bunInstall, stageProject } from "@command/isolated-install";
import { expect, test } from "vite-plus/test";

test("stages the complete fresh project without ancestor workspace scripts or writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "sync-engine-install-test-"));
  try {
    const app = join(root, "apps", "app");
    const dependency = join(root, "dependency");
    await mkdir(app, { recursive: true });
    await mkdir(dependency);
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "fixture-dependency", version: "1.0.0" }),
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        private: true,
        workspaces: ["apps/*"],
        scripts: { preinstall: "touch ancestor-executed" },
      }),
    );
    await writeFile(join(root, "bunfig.toml"), '[install]\nregistry = "http://127.0.0.1:1"\n');
    const before = await readFile(join(root, "package.json"), "utf8");
    await stageProject(app, async (stage) => {
      await writeFile(
        join(stage, "package.json"),
        JSON.stringify({
          name: "fixture-app",
          private: true,
          scripts: { preinstall: "touch child-executed" },
          dependencies: { "fixture-dependency": `file:${dependency}` },
        }),
      );
      await bunInstall(stage);
      expect(await readdir(app)).toEqual([]);
      await writeFile(
        join(stage, "future-setup-artifact.txt"),
        "published without a hardcoded artifact list",
      );
    });
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before);
    expect(await readdir(root)).not.toContain("ancestor-executed");
    expect(await readdir(root)).not.toContain("bun.lock");
    expect(await readdir(app)).not.toContain("child-executed");
    expect(await readFile(join(app, "bun.lock"), "utf8")).toContain("fixture-dependency");
    expect(await readFile(join(app, "future-setup-artifact.txt"), "utf8")).toContain("published");
    expect(
      JSON.parse(await readFile(join(app, "node_modules/fixture-dependency/package.json"), "utf8"))
        .version,
    ).toBe("1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "preserves trusted network configuration, home, and cache environment for Bun",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-install-env-"));
    const saved = { ...process.env };
    try {
      const bin = join(root, "bin");
      await mkdir(bin);
      await writeFile(
        join(bin, "bun"),
        '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("observed.json", JSON.stringify({ env: process.env, args: process.argv.slice(2) }));\n',
      );
      await chmod(join(bin, "bun"), 0o755);
      Object.assign(process.env, {
        PATH: `${bin}${delimiter}${saved.PATH}`,
        HTTPS_PROXY: "http://proxy.invalid",
        NPM_CONFIG_REGISTRY: "https://registry.invalid",
        SSL_CERT_FILE: "/trusted/ca.pem",
        BUN_INSTALL_CACHE_DIR: "/trusted/cache",
      });
      const app = join(root, "app");
      await mkdir(app);
      // Invoke the exact automatic installer inside its real staging boundary.
      await stageProject(app, bunInstall);
      const observed = JSON.parse(await readFile(join(app, "observed.json"), "utf8"));
      for (const key of [
        "HOME",
        "HTTPS_PROXY",
        "NPM_CONFIG_REGISTRY",
        "SSL_CERT_FILE",
        "BUN_INSTALL_CACHE_DIR",
      ]) {
        expect(observed.env[key]).toBe(process.env[key]);
      }
      expect(observed.args).toEqual(["install", "--ignore-scripts"]);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("failed preparation leaves a fresh destination empty and retryable", async () => {
  const root = await mkdtemp(join(tmpdir(), "sync-engine-stage-retry-"));
  try {
    await expect(
      stageProject(root, async (stage) => {
        await writeFile(join(stage, "package.json"), "{}");
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
    expect(await readdir(root)).toEqual([]);
    await stageProject(root, async (stage) => {
      await writeFile(join(stage, "package.json"), "{}");
    });
    expect(await readdir(root)).toEqual(["package.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
