import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  checkRelease,
  ownedDependencyManifests,
  projectReleaseManifests,
  releaseSourcePaths,
} from "@scripts/release";

const root = resolve(import.meta.dirname, "../../..");
const validSources = new Map(
  releaseSourcePaths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
);
const packageManifest = JSON.parse(validSources.get("package.json") ?? "") as {
  version: string;
  engines: { bun: string; node: string };
  packageManager: string;
};
const currentVersion = packageManifest.version;
const currentChangelog = validSources.get("CHANGELOG.md") ?? "";
const changelogVersions = [...currentChangelog.matchAll(/^## \[([^\]]+)\]/gm)].map(
  (match) => match[1] ?? "",
);
const previousVersion = changelogVersions[changelogVersions.indexOf(currentVersion) + 1];
if (previousVersion === undefined) throw new Error("current changelog entry has no predecessor");

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

  test("projects root facts into owned manifests", () => {
    const sources = fixture();
    editManifest(sources, ownedDependencyManifests[0], (manifest) => {
      manifest.dependencies["@mit-sdg/sync-engine"] = "stale";
      delete manifest.devDependencies["@types/node"];
      manifest.devDependencies.typescript = "stale";
      manifest.devDependencies.vite = "stale";
      manifest.devDependencies["vite-plus"] = "stale";
      delete manifest.overrides;
      manifest.engines.bun = "stale";
      manifest.engines.node = "stale";
      manifest.packageManager = "stale";
    });

    const projected = projectReleaseManifests(sources);
    sources.set(ownedDependencyManifests[0], projected.get(ownedDependencyManifests[0]) ?? "");
    expect(checkRelease(sources)).toEqual([]);
  });

  test("refuses to project an invalid canonical version", () => {
    const sources = fixture();
    editManifest(sources, "package.json", (manifest) => {
      manifest.version = "invalid";
    });
    expect(() => projectReleaseManifests(sources)).toThrow(/invalid release version/);
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
        `CHANGELOG.md: ${currentVersion} is missing the ${heading} heading`,
      );
    },
  );

  test("rejects an inexact current release link", () => {
    const sources = fixture();
    replaceSource(
      sources,
      "CHANGELOG.md",
      `releases/tag/v${currentVersion}`,
      "releases/tag/v1.0.0-beta.999",
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("release link"));
  });

  test("rejects a compare link that does not start at the previous entry", () => {
    const sources = fixture();
    replaceSource(
      sources,
      "CHANGELOG.md",
      `compare/v${previousVersion}...v${currentVersion}`,
      `compare/v0.3.0...v${currentVersion}`,
    );
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("compare link"));
  });

  test.each([
    ["1.0.0-alpha.0", "The first v1 alpha replaces, rather than extends, the 0.3 architecture."],
    ["0.3.0", "Replaced the sequencing and branching DSL"],
    ["0.2.0", "Removed the devtools package surface"],
    ["0.1.1", "Reworked the endpoint DSL"],
    ["0.1.0", "Initial public package"],
  ])("protects the complete released %s entry", (_version, prose) => {
    const sources = fixture();
    replaceSource(sources, "CHANGELOG.md", prose, "Rewritten released history.");
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining("byte-faithful"));
  });

  test("does not treat the shared changelog link footer as part of 0.1.0", () => {
    const sources = fixture();
    sources.set(
      "CHANGELOG.md",
      `${sources.get("CHANGELOG.md") ?? ""}\n[future]: https://example.test/future\n`,
    );
    expect(checkRelease(sources)).not.toContainEqual(expect.stringContaining("0.1.0 must remain"));
  });

  test("rejects a stale exact README evaluation version", () => {
    const sources = fixture();
    replaceSource(sources, "README.md", `\`@${currentVersion}\``, "`@1.0.0-beta.999`");
    expect(checkRelease(sources)).toContain(
      `README.md: exact evaluation version must be @${currentVersion}`,
    );
  });

  test.each([
    [
      "node engine",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.engines.node = ">=24";
      },
      "engines.node must support exactly one major",
    ],
    [
      "bun engine",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.engines.bun = ">=1.3.14";
      },
      "engines.bun must support exactly one minor",
    ],
    [
      "TypeScript range",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.dependencies.typescript = "^5.9.0";
      },
      "dependencies.typescript must support exactly one major",
    ],
    [
      "package manager",
      "package.json",
      (manifest: Record<string, any>): void => {
        manifest.packageManager = "bun@1.3.15";
      },
      "packageManager must pin the minimum supported Bun version",
    ],
  ] as const)("rejects a stale %s policy", (_name, path, edit, expected) => {
    const sources = fixture();
    editManifest(sources, path, edit);
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(expected));
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
    ["SUPPORT.md", `Node.js \`${packageManifest.engines.node}\``],
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
    const bunVersion = packageManifest.packageManager.slice("bun@".length);
    replaceSource(
      sources,
      ".github/workflows/ci.yml",
      `bun-version: "${bunVersion}"`,
      'bun-version: "0.0.0"',
    );
    expect(checkRelease(sources)).toContainEqual(
      expect.stringContaining(`bun-version ${bunVersion}`),
    );
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
    expect(
      checkRelease(sources).filter((failure) =>
        failure.startsWith(".github/workflows/publish.yml: verify"),
      ),
    ).toEqual([
      ".github/workflows/publish.yml: verify job must run bun run coverage",
      ".github/workflows/publish.yml: verify gates must remain in reviewed order",
    ]);
  });

  test.each([
    "needs: verify",
    "id-token: write",
    "name: npm",
    "npm publish ./release/package.tgz --provenance --tag beta --access public",
    "npm publish ./release/http-package.tgz --provenance --tag beta --access public",
  ])("requires the publish-only fact %s", (fact) => {
    const sources = fixture();
    replaceSource(sources, ".github/workflows/publish.yml", fact, "omitted-publish-fact");
    expect(checkRelease(sources)).toContainEqual(expect.stringContaining(`missing ${fact}`));
  });

  test("requires core to publish before HTTP", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/publish.yml",
      "npm publish ./release/package.tgz --provenance --tag beta --access public\n      - run: sha256sum --check release/http-package.tgz.sha256\n      - run: npm publish ./release/http-package.tgz --provenance --tag beta --access public",
      "npm publish ./release/http-package.tgz --provenance --tag beta --access public\n      - run: sha256sum --check release/http-package.tgz.sha256\n      - run: npm publish ./release/package.tgz --provenance --tag beta --access public",
    );
    expect(checkRelease(sources)).toContain(
      ".github/workflows/publish.yml: publish must release core before HTTP",
    );
  });

  test.each([
    "GITHUB_REF_NAME",
    "GITHUB_SHA",
    "origin/main",
    "[1-9]\\d*",
    "`v${core.version}`",
    "core.version !== http.version",
  ])("requires source validation fact %s", (fact) => {
    const sources = fixture();
    sources.set(
      ".github/workflows/publish.yml",
      (sources.get(".github/workflows/publish.yml") ?? "").replaceAll(fact, "omitted-source-fact"),
    );
    expect(
      checkRelease(sources).filter((failure) =>
        failure.endsWith(`source validation is missing ${fact}`),
      ),
    ).toEqual([
      `.github/workflows/publish.yml: verify source validation is missing ${fact}`,
      `.github/workflows/publish.yml: publish source validation is missing ${fact}`,
    ]);
  });

  test("requires a freshly fetched annotated tag at the release commit", () => {
    const sources = fixture();
    replaceSource(
      sources,
      ".github/workflows/publish.yml",
      'test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag',
      "test omitted-live-annotated-tag",
    );
    expect(checkRelease(sources)).toContainEqual(
      expect.stringContaining("source validation is missing annotated tag"),
    );
  });

  test("rejects release controls moved into comments or disabled steps", () => {
    const commented = fixture();
    replaceSource(
      commented,
      ".github/workflows/publish.yml",
      "      - run: bun run coverage",
      "      # - run: bun run coverage",
    );
    expect(checkRelease(commented)).toContain(
      ".github/workflows/publish.yml: verify job must run bun run coverage",
    );

    const disabled = fixture();
    replaceSource(
      disabled,
      ".github/workflows/publish.yml",
      "      - run: bun run coverage",
      "      - if: ${{ false }}\n        run: bun run coverage",
    );
    expect(checkRelease(disabled)).toContain(
      ".github/workflows/publish.yml: verify steps must not be conditional",
    );

    const dependency = fixture();
    replaceSource(
      dependency,
      ".github/workflows/publish.yml",
      "    needs: verify",
      "    # needs: verify",
    );
    expect(checkRelease(dependency)).toContain(
      ".github/workflows/publish.yml: publish job is missing needs: verify",
    );
  });

  test("requires enforcing run steps rather than inert command text", () => {
    const environment = fixture();
    replaceSource(
      environment,
      ".github/workflows/publish.yml",
      "      - run: bun run coverage",
      '      - run: "true"\n        env:\n          NOTE: bun run coverage',
    );
    expect(checkRelease(environment)).toContain(
      ".github/workflows/publish.yml: verify job must run bun run coverage",
    );

    const continuing = fixture();
    replaceSource(
      continuing,
      ".github/workflows/publish.yml",
      "      - run: bun run coverage",
      "      - run: bun run coverage\n        continue-on-error: true",
    );
    expect(checkRelease(continuing)).toContain(
      ".github/workflows/publish.yml: verify steps must not continue on error",
    );
  });

  test("requires the supported Node major in CI and publication", () => {
    const nodeMajor = /^>=(\d+)/.exec(packageManifest.engines.node)?.[1];
    if (nodeMajor === undefined) throw new Error("root Node range has no minimum major");
    const ci = fixture();
    ci.set(
      ".github/workflows/ci.yml",
      (ci.get(".github/workflows/ci.yml") ?? "").replaceAll(
        `          node-version: "${nodeMajor}"`,
        '          node-version: "22"',
      ),
    );
    expect(checkRelease(ci)).toContainEqual(expect.stringContaining("package job is missing"));
    expect(checkRelease(ci)).toContainEqual(expect.stringContaining("test job is missing"));

    const publish = fixture();
    replaceSource(
      publish,
      ".github/workflows/publish.yml",
      `          node-version: "${nodeMajor}"`,
      '          node-version: "22"',
    );
    expect(checkRelease(publish)).toContainEqual(
      expect.stringContaining("verify job is missing node-version"),
    );
  });
});
