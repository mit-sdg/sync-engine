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

  test("uses exact vocabulary references only when given an anchor", () => {
    const fallback = renderWireTypes(anchoredFixture);
    const anchored = renderWireTypes(anchoredFixture, {
      vocabulary: { from: "./vocabulary.ts", export: "vocabulary" },
    });

    expect(fallback).toContain('"entry": Json;');
    expect(fallback).not.toContain("ApplicationVocabulary");
    expect(anchored).toContain(
      'import type { vocabulary as ApplicationVocabulary } from "./vocabulary.ts";',
    );
    expect(anchored).toContain(
      'Jsonify<AtPath<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Ledger"]["add"]>>, ["entry"]>>',
    );
    expect(anchored).toContain(
      'Jsonify<AtPath<QueryRow<Awaited<ReturnType<(typeof ApplicationVocabulary.concepts)["Ledger"]["_labelOf"]>>>, ["label"]>> | null',
    );
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
            fields: [{ key: "value", type: { kind: "json" } }],
          },
          errors: [],
          openError: false,
        },
      ],
    };
    expect(() =>
      renderWireTypes(unresolved, {
        vocabulary: { from: "./vocabulary.ts", export: "vocabulary" },
        strictLeaves: true,
      }),
    ).toThrow("strictLeaves found unresolved Json at /opaque.output.value");
  });

  test("the anchored module typechecks exact client-facing leaves", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "sync-engine-wire-renderer-"));
    try {
      const wire = renderWireTypes(anchoredFixture, {
        vocabulary: { from: "./vocabulary.ts", export: "vocabulary" },
        strictLeaves: true,
      });
      const vocabulary = `
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
export declare const vocabulary: { concepts: { Ledger: LedgerConcept } };
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
      await Promise.all([
        writeFile(join(temporary, "wire.ts"), wire),
        writeFile(join(temporary, "vocabulary.ts"), vocabulary),
        writeFile(join(temporary, "consumer.ts"), consumer),
        writeFile(
          join(temporary, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              noEmit: true,
              module: "ESNext",
              moduleResolution: "Bundler",
              allowImportingTsExtensions: true,
              skipLibCheck: true,
            },
            files: ["consumer.ts", "vocabulary.ts", "wire.ts"],
          }),
        ),
      ]);
      const tsc = resolve("node_modules/typescript/bin/tsc");
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        tsc,
        "-p",
        join(temporary, "tsconfig.json"),
      ]);
      expect(`${stdout}${stderr}`).toBe("");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
