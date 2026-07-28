import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  checkRelease,
  ownedDependencyManifests,
  releaseSourcePaths,
} from "../../../scripts/release.ts";

const root = resolve(import.meta.dirname, "../../..");
const validSources = new Map(
  releaseSourcePaths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
);

function fixture(): Map<string, string> {
  return new Map(validSources);
}

function replaceSource(
  sources: Map<string, string>,
  path: string,
  current: string,
  replacement: string,
): void {
  const source = sources.get(path) ?? "";
  if (!source.includes(current)) throw new Error(`${path} fixture does not contain ${current}`);
  sources.set(path, source.replace(current, replacement));
}

function editManifest(
  sources: Map<string, string>,
  path: string,
  edit: (manifest: Record<string, any>) => void,
): void {
  const manifest = JSON.parse(sources.get(path) ?? "") as Record<string, any>;
  edit(manifest);
  sources.set(path, JSON.stringify(manifest));
}

describe("release source facts", () => {
  test("accepts the beta cutover sources", () => {
    expect(checkRelease(fixture())).toEqual([]);
  });

  test.each(["1.0.0-alpha.1", "1.0.0-beta.01", "1.0.1-beta.0"])(
    "rejects invalid beta version %s",
    (version) => {
      const sources = fixture();
      editManifest(sources, "package.json", (manifest) => {
        manifest.version = version;
      });
      expect(checkRelease(sources)).toContainEqual(
        expect.stringContaining("without leading zeroes"),
      );
    },
  );

  test("rejects a non-beta dist-tag", () => {
    const sources = fixture();
    editManifest(sources, "package.json", (manifest) => {
      manifest.publishConfig.tag = "latest";
    });
    expect(checkRelease(sources)).toContain('package.json: publishConfig.tag must be "beta"');
  });

  test.each(ownedDependencyManifests)("rejects a stale owned dependency in %s", (path) => {
    const sources = fixture();
    editManifest(sources, path, (manifest) => {
      manifest.dependencies["@mit-sdg/sync-engine"] = "1.0.0-alpha.0";
    });
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(`${path}:`));
  });

  test.each(["Compatibility", "Migration", "Generated formats", "Runtime and security support"])(
    "rejects a changelog without the %s heading",
    (heading) => {
      const sources = fixture();
      replaceSource(sources, "CHANGELOG.md", `### ${heading}`, `### Missing ${heading}`);
      expect(checkRelease(sources)).toContain(
        `CHANGELOG.md: 1.0.0-beta.0 is missing the ${heading} heading`,
      );
    },
  );

  test("rejects an inexact current release link", () => {
    const sources = fixture();
    replaceSource(
      sources,
      "CHANGELOG.md",
      "releases/tag/v1.0.0-beta.0",
      "releases/tag/v1.0.0-beta.1",
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("release link"));
  });

  test("rejects a compare link that does not start at the previous entry", () => {
    const sources = fixture();
    replaceSource(
      sources,
      "CHANGELOG.md",
      "compare/v1.0.0-alpha.0...v1.0.0-beta.0",
      "compare/v0.3.0...v1.0.0-beta.0",
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("compare link"));
  });

  test("protects the released alpha date", () => {
    const sources = fixture();
    replaceSource(
      sources,
      "CHANGELOG.md",
      "1.0.0-alpha.0] - 2026-07-27",
      "1.0.0-alpha.0] - 2026-07-28",
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("alpha.0 date"));
  });

  test.each([
    [
      "node engine",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.engines.node = ">=24";
      },
    ],
    [
      "bun engine",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.engines.bun = ">=1.3.14";
      },
    ],
    [
      "TypeScript range",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.dependencies.typescript = "^5.9.0";
      },
    ],
    [
      "package manager",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.packageManager = "bun@1.3.15";
      },
    ],
  ] as const)("rejects a stale %s policy", (_name, path, edit) => {
    const sources = fixture();
    editManifest(sources, path, edit);
    expect(checkRelease(sources)).not.toEqual([]);
  });

  test.each(["SUPPORT.md", "SECURITY.md"])(
    "requires %s in release sources and the package",
    (path) => {
      const missingSource = fixture();
      missingSource.delete(path);
      expect(checkRelease(missingSource)).toContain(`${path}: required release source is missing`);

      const omittedPackageFile = fixture();
      editManifest(omittedPackageFile, "package.json", (manifest) => {
        manifest.files = manifest.files.filter((entry: string) => entry !== path);
      });
      expect(checkRelease(omittedPackageFile)).toContain(`package.json: files must ship ${path}`);
    },
  );

  test.each([
    ["SUPPORT.md", "Only the newest beta is supported."],
    ["SUPPORT.md", "Node.js `>=24 <25`"],
    ["SECURITY.md", "security/advisories/new"],
    ["SECURITY.md", "acknowledgement within three business days"],
  ])("requires the policy fact %s: %s", (path, fact) => {
    const sources = fixture();
    replaceSource(sources, path, fact, "omitted-policy-fact");
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(`${path}: missing`));
  });

  test("requires both release code owners", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/CODEOWNERS",
      "/.github/workflows/ @BarishNamazov @eagonmeng",
      "/.github/workflows/ @BarishNamazov",
    );
    expect(checkRelease(sources)).toContain(
      ".github/CODEOWNERS: /.github/workflows/ must require both release code owners",
    );
  });

  test("requires reviewed GitHub Actions updates", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/dependabot.yml",
      "package-ecosystem: github-actions",
      "package-ecosystem: npm",
    );
    expect(checkRelease(sources)).toContainEqual(
      expect.stringContaining("missing reviewed action-update fact"),
    );
  });

  test("rejects an unreviewed action pin", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/ci.yml",
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/checkout@0000000000000000000000000000000000000000",
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("reviewed SHA"));
  });

  test("rejects an unpinned CI Bun version", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/ci.yml",
      'bun-version: "1.3.14"',
      'bun-version: "1.3.15"',
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("bun-version 1.3.14"));
  });

  test.each([
    "name: Generated artifacts",
    "run: bun run examples:check",
    "name: CI required",
    "needs: [check, release, build, package, generated, scenario, test, coverage]",
  ])("rejects CI without %s", (fact) => {
    const sources = fixture();
    replaceSource(sources, ".github/workflows/ci.yml", fact, "omitted-ci-fact");
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(`missing ${fact}`));
  });

  test("rejects a privileged publish verification job", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/publish.yml",
      "  verify:\n",
      "  verify:\n    environment: npm\n",
    );
    expect(checkRelease(sources)).toContainEqual(
      expect.stringContaining("verify must be unprivileged"),
    );
  });

  test("requires every publish verification gate", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/publish.yml",
      "bun run coverage",
      "bun run omitted-coverage",
    );
    expect(checkRelease(sources)).toContain(
      ".github/workflows/publish.yml: verify job must run bun run coverage",
    );
  });

  test.each([
    "needs: verify",
    "id-token: write",
    "name: npm",
    "npm publish --provenance --tag beta --access public",
  ])("requires the publish-only fact %s", (fact) => {
    const sources = fixture();
    replaceSource(sources, ".github/workflows/publish.yml", fact, "omitted-publish-fact");
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(`missing ${fact}`));
  });

  test.each(["GITHUB_REF_NAME", "GITHUB_SHA", "origin/main", "[1-9]\\d*"])(
    "requires source validation fact %s",
    (fact) => {
      const sources = fixture();
      replaceSource(sources, ".github/workflows/publish.yml", fact, "omitted-source-fact");
      expect(checkRelease(sources)).toContainEqual(
        expect.stringContaining(`source validation is missing ${fact}`),
      );
    },
  );
});
