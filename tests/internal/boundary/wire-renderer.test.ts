import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";
import type { WireContractsIR } from "@sync-engine/internal/boundary/wire/wire-contracts";
import { renderWireTypes } from "@sync-engine/internal/boundary/wire/wire-renderer";
import type { WireOrigin, WireType } from "@sync-engine/internal/boundary/wire/wire-types";

const execFileAsync = promisify(execFile);

function reference(...allOf: WireOrigin[]): WireType {
  return { kind: "reference", allOf, sites: ["renderer fixture"] };
}

function wireWithOutput(output: WireType): WireContractsIR {
  return {
    appWide: [],
    endpoints: [
      {
        path: "/value",
        input: { kind: "object", fields: [] },
        output,
        errors: [],
        openError: false,
      },
    ],
  };
}

async function typecheck(sources: Record<string, string>): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "sync-engine-wire-renderer-"));
  try {
    await Promise.all([
      ...Object.entries(sources).map(([path, source]) => writeFile(join(temporary, path), source)),
      writeFile(
        join(temporary, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noUnusedLocals: true,
            noEmit: true,
            module: "ESNext",
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            skipLibCheck: true,
          },
          files: Object.keys(sources),
        }),
      ),
    ]);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      resolve("node_modules/typescript/bin/tsc"),
      "-p",
      join(temporary, "tsconfig.json"),
    ]);
    expect(`${stdout}${stderr}`).toBe("");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const renderedFixture: WireContractsIR = {
  appWide: ["INVALID_SESSION"],
  endpoints: [
    {
      path: "/ledger/add",
      input: {
        kind: "object",
        fields: [
          {
            key: "amount",
            type: reference({
              source: "action-input",
              concept: "Ledger",
              member: "add",
              path: ["amount"],
            }),
          },
          {
            key: "item",
            type: reference({
              source: "action-input",
              concept: "Ledger",
              member: "add",
              path: ["item"],
            }),
          },
          { key: "note", type: { kind: "json" }, optional: true },
          { key: "session", type: { kind: "json" } },
        ],
      },
      output: {
        kind: "object",
        fields: [
          {
            key: "entry",
            type: reference({
              source: "action-output",
              concept: "Ledger",
              member: "add",
              path: ["entry"],
            }),
          },
        ],
      },
      errors: ["FORBIDDEN", "INVALID_INPUT", "NEGATIVE_AMOUNT"],
      openError: false,
    },
    {
      path: "/ledger/feed",
      input: {
        kind: "object",
        fields: [
          {
            key: "sort",
            type: {
              kind: "union",
              of: [
                { kind: "literal", value: "activity" },
                { kind: "literal", value: "created" },
              ],
            },
          },
        ],
      },
      output: {
        kind: "object",
        fields: [{ key: "uses", type: { kind: "array", of: { kind: "union", of: [] } } }],
      },
      errors: [],
      openError: false,
    },
  ],
};

const anchoredFixture: WireContractsIR = {
  appWide: [],
  endpoints: [
    {
      path: "/conflict",
      input: {
        kind: "object",
        fields: [
          {
            key: "value",
            type: reference(
              {
                source: "action-input",
                concept: "Ledger",
                member: "rename",
                path: ["name"],
              },
              {
                source: "action-input",
                concept: "Ledger",
                member: "setAmount",
                path: ["amount"],
              },
            ),
          },
        ],
      },
      output: { kind: "object", fields: [{ key: "ok", type: { kind: "literal", value: true } }] },
      errors: [],
      openError: false,
    },
    {
      path: "/ledger/add",
      input: {
        kind: "object",
        fields: [
          {
            key: "amount",
            type: reference({
              source: "action-input",
              concept: "Ledger",
              member: "add",
              path: ["amount"],
            }),
          },
          {
            key: "item",
            type: reference({
              source: "action-input",
              concept: "Ledger",
              member: "add",
              path: ["item"],
            }),
          },
        ],
      },
      output: {
        kind: "object",
        fields: [
          {
            key: "entry",
            type: reference({
              source: "action-output",
              concept: "Ledger",
              member: "add",
              path: ["entry"],
            }),
          },
        ],
      },
      errors: [],
      openError: false,
    },
    {
      path: "/ledger/list",
      input: { kind: "object", fields: [] },
      output: {
        kind: "object",
        fields: [
          {
            key: "rows",
            type: {
              kind: "array",
              of: {
                kind: "object",
                fields: [
                  {
                    key: "amount",
                    type: reference({
                      source: "query-output",
                      concept: "Ledger",
                      member: "_rows",
                      path: ["amount"],
                    }),
                  },
                  {
                    key: "entry",
                    type: reference({
                      source: "query-output",
                      concept: "Ledger",
                      member: "_rows",
                      path: ["entry"],
                    }),
                  },
                  {
                    key: "item",
                    type: reference({
                      source: "query-output",
                      concept: "Ledger",
                      member: "_rows",
                      path: ["item"],
                    }),
                  },
                  {
                    key: "label",
                    type: {
                      kind: "union",
                      of: [
                        reference({
                          source: "query-output",
                          concept: "Ledger",
                          member: "_labelOf",
                          path: ["label"],
                        }),
                        { kind: "literal", value: null },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      errors: [],
      openError: false,
    },
  ],
};

describe("wire TypeScript renderer", () => {
  test("emits a client-pluggable module from wire IR", () => {
    const source = renderWireTypes(renderedFixture);
    expect(source).toContain('export type AppWideError = "INVALID_SESSION";');
    expect(source).toContain('"/ledger/add": {');
    expect(source).toContain(
      'error: { error: AppWideError | "FORBIDDEN" | "INVALID_INPUT" | "NEGATIVE_AMOUNT" };',
    );
    expect(source).toContain('"sort": "activity" | "created";');
    expect(source).toContain('"uses": never[];');
    expect(source).toContain("export type Json =");
  });

  test("appends a named projection under shared helpers", () => {
    const logical = renderWireTypes(renderedFixture, { moduleName: "ApplicationWire" });
    const projected = renderWireTypes(renderedFixture, {
      moduleName: "ApplicationWireHttp",
      appWideErrorName: "HttpAppWideError",
      preamble: false,
    });
    const source = `${logical}\n${projected}`;

    expect(source.match(/export type Json =/g)).toHaveLength(1);
    expect(source).toContain("export type ApplicationWire = {");
    expect(source).toContain("export type HttpAppWideError =");
    expect(source).toContain("export type ApplicationWireHttp = {");
    expect(source).toContain("error: { error: HttpAppWideError");
  });

  test("uses exact concept-set references only when given an anchor", () => {
    const fallback = renderWireTypes(anchoredFixture);
    const anchored = renderWireTypes(anchoredFixture, {
      conceptSet: { from: "./concepts.ts", export: "applicationConcepts" },
    });

    expect(fallback).toContain('"entry": Json;');
    expect(fallback).not.toContain("ApplicationConceptSet");
    expect(anchored).toContain(
      'import type { applicationConcepts as ApplicationConceptSet } from "./concepts.ts";',
    );
    expect(anchored).toContain(
      'Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationConceptSet.concepts)["Ledger"]["add"]>>, ["entry"]>>',
    );
    expect(anchored).toContain(
      'Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationConceptSet.concepts)["Ledger"]["_labelOf"]>>>, ["label"]>> | null',
    );
    expect(anchored).not.toContain("type OneOf<");
  });

  test("emits exactly the helpers used by sparse and appended contracts", async () => {
    const conceptSet = { from: "./concepts.ts", export: "applicationConcepts" };
    const empty = renderWireTypes(wireWithOutput(reference()), {
      moduleName: "EmptyWire",
      conceptSet,
    });
    const literal = renderWireTypes(
      wireWithOutput({
        kind: "union",
        of: [
          { kind: "literal", value: null },
          {
            kind: "union",
            of: [
              reference({ source: "literal", value: "left" }),
              reference({ source: "literal", value: "right" }),
            ],
          },
        ],
      }),
      { moduleName: "LiteralWire", conceptSet },
    );
    const number = renderWireTypes(wireWithOutput(reference({ source: "number" })), {
      moduleName: "NumberWire",
      conceptSet,
    });
    const appendedWire = wireWithOutput(
      reference({
        source: "query-output",
        concept: "Ledger",
        member: "rows",
        path: ["value"],
      }),
    );
    const preamble = renderWireTypes(wireWithOutput({ kind: "literal", value: true }), {
      moduleName: "LogicalWire",
      conceptSet,
      sharedWires: [appendedWire],
    });
    const appended = renderWireTypes(appendedWire, {
      moduleName: "AppendedWire",
      appWideErrorName: "AppendedAppWideError",
      conceptSet,
      preamble: false,
    });

    expect(empty).toContain("type AllOf<");
    expect(empty).toContain("type Jsonify<");
    expect(empty).not.toContain("ApplicationConceptSet");
    expect(empty).not.toContain("type AtPath<");
    expect(literal).toContain("type OneOf<");
    expect(literal).toContain("type Jsonify<");
    expect(literal).not.toContain("ApplicationConceptSet");
    expect(literal).not.toContain("type AtPath<");
    expect(literal).not.toContain("type AllOf<");
    expect(number).toContain("type Jsonify<");
    expect(number).not.toContain("ApplicationConceptSet");
    expect(number).not.toContain("type AtPath<");
    expect(number).not.toContain("type AllOf<");
    expect(number).not.toContain("type OneOf<");
    expect(preamble).toContain("ApplicationConceptSet");
    expect(preamble).toContain("type AtPath<");
    expect(preamble).toContain("type QueryRow<");

    await typecheck({
      "empty.ts": empty,
      "literal.ts": literal,
      "number.ts": number,
      "appended.ts": `${preamble}\n${appended}`,
      "concepts.ts": `
export declare const applicationConcepts: {
  concepts: { Ledger: { rows(input: Record<string, never>): readonly { value: string }[] } };
};
`,
    });
  });

  test("strict rendering rejects a hand-built unresolved leaf", () => {
    const unresolved: WireContractsIR = {
      appWide: [],
      endpoints: [
        {
          path: "/opaque",
          input: { kind: "object", fields: [] },
          output: {
            kind: "object",
            fields: [
              {
                key: "value",
                type: {
                  kind: "union",
                  of: [
                    { kind: "json" },
                    {
                      kind: "object",
                      fields: [{ key: "nested", type: { kind: "json" } }],
                    },
                    { kind: "array", of: { kind: "json" } },
                  ],
                },
              },
            ],
          },
          errors: [],
          openError: false,
        },
      ],
    };
    expect(() =>
      renderWireTypes(unresolved, {
        conceptSet: { from: "./concepts.ts", export: "applicationConcepts" },
        strictLeaves: true,
      }),
    ).toThrow(
      "strictLeaves found unresolved Json at /opaque.output.value, /opaque.output.value.nested, /opaque.output.value[]",
    );
  });

  test("the anchored module typechecks computation parameter and result leaves", async () => {
    const computationWire: WireContractsIR = {
      appWide: [],
      endpoints: [
        {
          path: "/setup/register-admin",
          input: {
            kind: "object",
            fields: [
              {
                key: "setupSecret",
                type: reference({
                  source: "computation-input",
                  computation: "setupSecretMatches",
                  path: ["secret"],
                }),
              },
            ],
          },
          output: {
            kind: "object",
            fields: [
              {
                key: "valid",
                type: reference({
                  source: "computation-output",
                  computation: "setupSecretMatches",
                  path: [],
                }),
              },
            ],
          },
          errors: [],
          openError: false,
        },
      ],
    };
    const wire = renderWireTypes(computationWire, {
      conceptSet: { from: "./concepts.ts", export: "applicationConcepts" },
      strictLeaves: true,
    });
    const conceptSet = `
export declare const applicationConcepts: {
  concepts: Record<string, never>;
  computations: {
    setupSecretMatches: { fn: (input: { secret: string }) => Promise<boolean> };
  };
};
`;
    const consumer = `
import type { WireContracts } from "./wire.ts";

const input: WireContracts["/setup/register-admin"]["input"] = { setupSecret: "secret" };
const output: WireContracts["/setup/register-admin"]["output"] = { valid: true };
void input;
void output;

// @ts-expect-error setupSecret follows the computation parameter's string field.
const wrongInput: WireContracts["/setup/register-admin"]["input"] = { setupSecret: 1 };
// @ts-expect-error valid follows the awaited computation result.
const wrongOutput: WireContracts["/setup/register-admin"]["output"] = { valid: "yes" };
void wrongInput;
void wrongOutput;
`;

    await typecheck({ "wire.ts": wire, "concepts.ts": conceptSet, "consumer.ts": consumer });
  });

  test("the anchored module typechecks exact client-facing leaves", async () => {
    const wire = renderWireTypes(anchoredFixture, {
      conceptSet: { from: "./concepts.ts", export: "applicationConcepts" },
      strictLeaves: true,
    });
    const conceptSet = `
export class LedgerConcept {
  add(_: { item: string; amount: number }): { entry: string } {
    return { entry: "entry" };
  }
  _rows(_: Record<string, never>): { entry: string; item: string; amount: number }[] {
    return [];
  }
  _labelOf(_: { item: string }): { label: string }[] {
    return [];
  }
  rename(_: { name: string }): Record<string, never> {
    return {};
  }
  setAmount(_: { amount: number }): Record<string, never> {
    return {};
  }
}
export declare const applicationConcepts: { concepts: { Ledger: LedgerConcept } };
`;
    const consumer = `
import type { WireContracts } from "./wire.ts";

const input: WireContracts["/ledger/add"]["input"] = { item: "item", amount: 3 };
const output: WireContracts["/ledger/add"]["output"] = { entry: "entry" };
const row: WireContracts["/ledger/list"]["output"]["rows"][number] = {
  entry: "entry",
  item: "item",
  amount: 3,
  label: null,
};
void input;
void output;
void row;

// @ts-expect-error amount follows Ledger.add's number input.
const wrongInput: WireContracts["/ledger/add"]["input"] = { item: "item", amount: "3" };
// @ts-expect-error entry follows Ledger.add's string output.
const wrongOutput: WireContracts["/ledger/add"]["output"] = { entry: 3 };
// @ts-expect-error the conflicting endpoint constrains value to string and number.
const conflict: WireContracts["/conflict"]["input"] = { value: "value" };
void wrongInput;
void wrongOutput;
void conflict;
`;
    await typecheck({ "wire.ts": wire, "concepts.ts": conceptSet, "consumer.ts": consumer });
  });
});
