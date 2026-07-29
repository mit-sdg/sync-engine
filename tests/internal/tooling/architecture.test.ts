import { describe, expect, test } from "vite-plus/test";
import { checkArchitecture, type ArchitectureProject } from "@scripts/architecture";

const manifest = {
  exports: {
    "./language": {
      types: "./dist/language/index.d.ts",
      import: "./dist/language/index.js",
    },
  },
};
const config = {
  compilerOptions: {
    paths: {
      "@engine/*": ["./src/engine/*"],
      "@mit-sdg/sync-engine/*": ["./src/*/index.ts"],
    },
  },
};

function fixture(changes: Record<string, string | undefined> = {}): ArchitectureProject {
  const files = new Map<string, string>([
    ["package.json", JSON.stringify(manifest)],
    ["tsconfig.json", JSON.stringify(config)],
    ["src/language/index.ts", 'export { value } from "@engine/utils/value";\n'],
    ["src/engine/utils/value.ts", 'export const value = "fixture-value";\n'],
  ]);
  for (const [path, text] of Object.entries(changes)) {
    if (text === undefined) files.delete(path);
    else files.set(path, text);
  }
  return {
    files,
    repositoryFiles: [...files.keys()],
    projectDirectories: new Set(["examples/demo/"]),
  };
}

function failures(changes: Record<string, string | undefined>): string[] {
  return checkArchitecture(fixture(changes)).failures;
}

describe("architecture rule fixtures", () => {
  test("accepts the minimal valid fixture", () => {
    expect(checkArchitecture(fixture())).toEqual({ failures: [], runtimeCycles: [] });
  });

  test("rejects a same-concern alias", () => {
    expect(
      failures({
        "src/engine/utils/value.ts":
          'import { other } from "@engine/utils/other";\nexport const value = other;\n',
        "src/engine/utils/other.ts": 'export const other = "same-concern";\n',
      }),
    ).toContainEqual(expect.stringContaining("within the utils concern must be relative"));
  });

  test("rejects a cross-concern relative import", () => {
    expect(
      failures({
        "src/engine/utils/value.ts":
          'import { number } from "../reads/number.ts";\nexport const value = number;\n',
        "src/engine/reads/number.ts": "export const number = 1;\n",
      }),
    ).toContainEqual(expect.stringContaining("crossing engine concerns must use @engine"));
  });

  test("rejects a missing relative TypeScript extension", () => {
    expect(
      failures({
        "src/engine/utils/value.ts":
          'import { other } from "./other";\nexport const value = other;\n',
        "src/engine/utils/other.ts": 'export const other = "missing-extension";\n',
      }),
    ).toContainEqual(
      expect.stringContaining("relative engine imports must include the .ts extension"),
    );
  });

  test("rejects an extension on a cross-concern alias", () => {
    expect(
      failures({
        "src/language/index.ts": 'export { value } from "@engine/reads/value.ts";\n',
        "src/engine/reads/value.ts":
          'import { number } from "@engine/utils/number.ts";\nexport const value = number;\n',
        "src/engine/utils/value.ts": undefined,
        "src/engine/utils/number.ts": "export const number = 2;\n",
      }),
    ).toContainEqual(expect.stringContaining("@engine imports must omit the .ts extension"));
  });

  test("rejects an engine import from a public barrel", () => {
    expect(
      failures({
        "src/engine/utils/value.ts":
          'import type { value as PublicValue } from "@mit-sdg/sync-engine/language";\n' +
          'export const value: typeof PublicValue = "public-barrel";\n',
      }),
    ).toContainEqual(expect.stringContaining("engine modules may not import public entrypoints"));
  });

  test("rejects a forbidden concern edge", () => {
    expect(
      failures({
        "src/engine/utils/value.ts":
          'import { number } from "@engine/reads/number";\nexport const value = number;\n',
        "src/engine/reads/number.ts": "export const number = 3;\n",
      }),
    ).toContainEqual(expect.stringContaining("utils may not depend on reads"));
  });

  test("enforces the explicit reaction-area dependency matrix", () => {
    expect(
      failures({
        "src/language/index.ts": 'export { value } from "@engine/reactions/authoring/value";\n',
        "src/engine/utils/value.ts": undefined,
        "src/engine/reactions/authoring/value.ts":
          'import { execute } from "../runtime/execute.ts";\nexport const value = execute;\n',
        "src/engine/reactions/runtime/execute.ts":
          'export const execute = "forbidden-runtime-edge";\n',
      }),
    ).toContainEqual(expect.stringContaining("reactions/authoring -> reactions/runtime"));
  });

  test("rejects an engine barrel", () => {
    expect(
      failures({
        "src/language/index.ts": 'export { gathered } from "@engine/utils/index";\n',
        "src/engine/utils/value.ts": undefined,
        "src/engine/utils/index.ts": 'export const gathered = "root-barrel";\n',
      }),
    ).toContainEqual(expect.stringContaining("engine index barrels are forbidden"));
  });

  test("rejects unreachable shipped source", () => {
    expect(
      failures({
        "src/engine/utils/unreachable.ts": 'export const unused = "unreachable-source";\n',
      }),
    ).toContain("src/engine/utils/unreachable.ts: shipped source is unreachable");
  });

  test("rejects generated material without provenance or an owner", () => {
    expect(
      failures({
        "examples/demo/generated/output.ts": 'export const output = "hand-written";\n',
        "examples/demo/generated.config.ts":
          'export default { application: "./application.ts" };\n',
      }),
    ).toContainEqual(expect.stringContaining("generated material must name its provenance"));
    expect(
      failures({
        "examples/demo/generated/output.ts":
          '// Generated by the architecture fixture. Do not edit.\nexport const output = "owned";\n',
      }),
    ).toContainEqual(
      expect.stringContaining("generated material has no owning generated.config.ts"),
    );
  });

  test("rejects a package export target mismatch", () => {
    const mismatched = {
      exports: {
        "./language": {
          types: "./dist/language/index.d.ts",
          import: "./dist/wrong/index.js",
        },
      },
    };
    expect(failures({ "package.json": JSON.stringify(mismatched) })).toContainEqual(
      expect.stringContaining("package export must map types"),
    );
  });

  test.each(["actions/checkout@v7", "actions/checkout@3d3c42e5"])(
    "rejects external workflow action reference %s",
    (action) => {
      expect(
        failures({
          ".github/workflows/fixture.yml": `jobs:\n  check:\n    steps:\n      - uses: ${action}\n`,
        }),
      ).toContainEqual(expect.stringContaining("must use an exact 40-hex SHA"));
    },
  );

  test("allows repository-local workflow actions", () => {
    expect(
      failures({
        ".github/workflows/fixture.yml":
          "jobs:\n  check:\n    steps:\n      - uses: ./.github/actions/check\n",
      }),
    ).not.toContainEqual(expect.stringContaining("must use an exact 40-hex SHA"));
  });
});

describe("runtime import SCC fixtures", () => {
  test("rejects and reports a runtime cycle", () => {
    const project = fixture({
      "src/engine/utils/value.ts":
        'import { other } from "./other.ts";\nexport const value = other;\n',
      "src/engine/utils/other.ts":
        'import { value } from "./value.ts";\nexport const other = value;\n',
    });
    const result = checkArchitecture(project);
    expect(result).toEqual({
      failures: ["runtime import cycle: src/engine/utils/other.ts, src/engine/utils/value.ts"],
      runtimeCycles: [["src/engine/utils/other.ts", "src/engine/utils/value.ts"]],
    });
  });

  test.each([
    'import type { Value } from "./value.ts";\nexport const other: Value = "type-only";\n',
    'import { type Value } from "./value.ts";\nexport const other: Value = "inline-type";\n',
    'export type { Value } from "./value.ts";\nexport const other = "type-export";\n',
  ])("ignores a type-only edge", (typeOnlyImport) => {
    const project = fixture({
      "src/engine/utils/value.ts":
        'import { other } from "./other.ts";\nexport type Value = string;\nexport const value = other;\n',
      "src/engine/utils/other.ts": typeOnlyImport,
    });
    expect(checkArchitecture(project)).toEqual({ failures: [], runtimeCycles: [] });
  });
});
