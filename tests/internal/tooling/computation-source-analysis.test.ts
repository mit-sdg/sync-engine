import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  authoritativeComputationInputs,
  resolveComputationInputsFromSource,
} from "@command/computation-source-analysis";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sync-engine-computations-"));
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      include: ["*.ts"],
    }),
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function source(name: string, text: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, text);
  return path;
}

const DECLARATIONS = `declare function conceptSet(concepts: object, computations?: object): unknown;
declare function vocabulary(declaration: object): unknown;
`;

describe("authoritative computation source analysis", () => {
  test("resolves local and imported aliases, static spreads, and equivalent optional fields", async () => {
    await source(
      "api.ts",
      "export declare function conceptSet(concepts: object, computations?: object): unknown;\n",
    );
    await source(
      "shared.ts",
      `export interface ImportedInput { required: string; union: number | undefined; }
export function imported(value: ImportedInput): string { return value.required; }
export const shared = { importedAlias: imported };
`,
    );
    const module = await source(
      "vocabulary.ts",
      `import { conceptSet as configure } from "./api.ts";
import { imported as renamed, shared as importedSpread } from "./shared.ts";
type LocalInput = { first?: string; second: number };
const localFunction = (input: LocalInput) => input.second;
const localAlias = localFunction;
const spreadAlias = importedSpread;
configure({}, { ...spreadAlias, renamed, localAlias });
`,
    );

    expect(
      authoritativeComputationInputs(module, ["renamed", "localAlias", "importedAlias"]),
    ).toEqual([
      {
        name: "importedAlias",
        inputs: [
          { name: "required", optional: false },
          { name: "union", optional: true },
        ],
      },
      {
        name: "localAlias",
        inputs: [
          { name: "first", optional: true },
          { name: "second", optional: false },
        ],
      },
      {
        name: "renamed",
        inputs: [
          { name: "required", optional: false },
          { name: "union", optional: true },
        ],
      },
    ]);
  });

  test("resolves the computations property of vocabulary through object spreads", async () => {
    const module = await source(
      "vocabulary.ts",
      `${DECLARATIONS}type Input = { value: string | undefined };
const calculate = ({ value }: Input) => value;
const computationMap = { calculate };
const declarationBase = { concepts: {} };
const declaration = { ...declarationBase, computations: computationMap };
vocabulary(declaration);
`,
    );

    expect(authoritativeComputationInputs(module, ["calculate"])).toEqual([
      { name: "calculate", inputs: [{ name: "value", optional: true }] },
    ]);
  });

  test("returns authoritative empty input when no computations are selected or declared", async () => {
    const module = await source("vocabulary.ts", `${DECLARATIONS}conceptSet({});\n`);
    expect(authoritativeComputationInputs(module, [])).toEqual([]);

    const resolver = resolveComputationInputsFromSource(module);
    expect(await resolver({ assembly: {} as never, computations: [] })).toEqual([]);
  });

  test("fails closed for dynamic and computed maps", async () => {
    const dynamic = await source(
      "dynamic.ts",
      `${DECLARATIONS}declare const builtElsewhere: object;
conceptSet({}, { ...builtElsewhere });
`,
    );
    expect(() => authoritativeComputationInputs(dynamic, [])).toThrow("spread is dynamic");

    const computed = await source(
      "computed.ts",
      `${DECLARATIONS}const name = "calculate";
const calculate = (input: { value: string }) => input.value;
conceptSet({}, { [name]: calculate });
`,
    );
    expect(() => authoritativeComputationInputs(computed, ["calculate"])).toThrow(
      "dynamic or computed name",
    );
  });

  test("fails closed for ambiguous registrations and unresolved input types", async () => {
    const ambiguous = await source(
      "ambiguous.ts",
      `${DECLARATIONS}conceptSet({});
vocabulary({ concepts: {} });
`,
    );
    expect(() => authoritativeComputationInputs(ambiguous, [])).toThrow("multiple");

    const unresolved = await source(
      "unresolved.ts",
      `${DECLARATIONS}const calculate = (input: MissingInput) => input;
conceptSet({}, { calculate });
`,
    );
    expect(() => authoritativeComputationInputs(unresolved, ["calculate"])).toThrow(
      "input shape cannot be resolved",
    );
  });

  test("rejects extra or missing selected computation names", async () => {
    const module = await source(
      "vocabulary.ts",
      `${DECLARATIONS}const first = (input: { value: string }) => input.value;
const second = () => 2;
conceptSet({}, { first, second });
`,
    );
    expect(() => authoritativeComputationInputs(module, ["first"])).toThrow(
      "extra declarations: second",
    );
    expect(() => authoritativeComputationInputs(module, ["first", "missing", "second"])).toThrow(
      "missing declarations: missing",
    );
  });

  test("rejects inferred or non-object inputs instead of claiming a shape", async () => {
    const inferred = await source(
      "inferred.ts",
      `${DECLARATIONS}const calculate = (input) => input;
conceptSet({}, { calculate });
`,
    );
    expect(() => authoritativeComputationInputs(inferred, ["calculate"])).toThrow(
      "input type is not explicitly declared",
    );

    const scalar = await source(
      "scalar.ts",
      `${DECLARATIONS}const calculate = (input: string) => input;
conceptSet({}, { calculate });
`,
    );
    expect(() => authoritativeComputationInputs(scalar, ["calculate"])).toThrow("non-object type");
  });
});
