import { describe, expect, test } from "vite-plus/test";
import type { AppIR, PatternIR } from "@sync-engine/internal/reads/ir";
import { wireContracts } from "@sync-engine/internal/boundary/wire/wire-contracts";
import {
  applyOpsProvenance,
  referenceOf,
} from "@sync-engine/internal/boundary/wire/wire-provenance";
import type { WireType } from "@sync-engine/internal/boundary/wire/wire-types";

const variable = (name: string): { $var: string } => ({ $var: name });

const requestPattern: PatternIR = {
  path: "/ledger/add",
  item: variable("item"),
  amount: variable("amount"),
  requestId: variable("requestId"),
};

const app: AppIR = {
  unlowered: [],
  views: [],
  formers: [
    {
      name: "the ledger rows ()",
      ins: [],
      bindings: ["entry", "item", "amount"],
      promise: "one",
      body: {
        node: "each",
        from: {
          op: "find",
          query: { concept: "Ledger", query: "_rows" },
          in: {},
          out: {
            entry: variable("entry"),
            item: variable("item"),
            amount: variable("amount"),
          },
        },
        where: [
          {
            op: "whether",
            query: { concept: "Ledger", query: "_labelOf" },
            in: { item: variable("item") },
            out: { label: variable("display") },
          },
        ],
        as: {
          node: "record",
          entries: {
            entry: { node: "leaf", var: "entry" },
            item: { node: "leaf", var: "item" },
            amount: { node: "leaf", var: "amount" },
            label: { node: "leaf", var: "display" },
          },
        },
      },
    },
  ],
  reactions: [
    {
      name: "LedgerAdd",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: requestPattern,
          output: {},
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "Ledger",
          action: "add",
          input: { item: variable("item"), amount: variable("amount") },
        },
      ],
    },
    {
      name: "LedgerAdd#2",
      when: [
        {
          kind: "action",
          concept: "Ledger",
          action: "add",
          posture: "returned",
          by: "LedgerAdd",
          input: { item: variable("item"), amount: variable("amount") },
          output: { entry: variable("entry") },
        },
      ],
      where: [
        {
          op: "earlier",
          when: {
            kind: "action",
            concept: "RequestBoundary",
            action: "request",
            input: requestPattern,
            output: {},
          },
        },
      ],
      then: [
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: variable("requestId"), entry: variable("entry") },
        },
      ],
    },
    {
      name: "LedgerList",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: { path: "/ledger/list", requestId: variable("requestId") },
          output: {},
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: {
            requestId: variable("requestId"),
            rows: { $former: { name: "the ledger rows ()", in: {} } },
          },
        },
      ],
    },
  ],
};

const branchAndConflictApp: AppIR = {
  unlowered: [],
  views: [
    {
      name: "(subject) is accepted",
      ins: ["subject"],
      outs: [],
      bindings: [],
      holds: true,
      alternatives: [
        [
          {
            op: "find",
            query: { concept: "Ledger", query: "_text" },
            in: { text: variable("subject") },
            out: {},
          },
        ],
        [
          {
            op: "find",
            query: { concept: "Ledger", query: "_amount" },
            in: { amount: variable("subject") },
            out: {},
          },
        ],
      ],
    },
  ],
  formers: [],
  reactions: [
    {
      name: "ChooseText",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: {
            path: "/choose",
            kind: "text",
            value: variable("value"),
            requestId: variable("requestId"),
          },
          output: {},
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "Ledger",
          action: "rename",
          input: { name: variable("value") },
        },
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: variable("requestId"), ok: true },
        },
      ],
    },
    {
      name: "ChooseAmount",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: {
            path: "/choose",
            kind: "amount",
            value: variable("value"),
            requestId: variable("requestId"),
          },
          output: {},
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "Ledger",
          action: "setAmount",
          input: { amount: variable("value") },
        },
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: variable("requestId"), ok: true },
        },
      ],
    },
    {
      name: "Conflict",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: {
            path: "/conflict",
            value: variable("value"),
            requestId: variable("requestId"),
          },
          output: {},
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "Ledger",
          action: "rename",
          input: { name: variable("value") },
        },
        {
          kind: "request",
          concept: "Ledger",
          action: "setAmount",
          input: { amount: variable("value") },
        },
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: variable("requestId"), ok: true },
        },
      ],
    },
    {
      name: "ViewAlternatives",
      when: [
        {
          kind: "action",
          concept: "RequestBoundary",
          action: "request",
          input: {
            path: "/view",
            value: variable("value"),
            requestId: variable("requestId"),
          },
          output: {},
        },
      ],
      where: [
        {
          op: "find",
          view: "(subject) is accepted",
          in: { subject: variable("value") },
          out: {},
        },
      ],
      then: [
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: variable("requestId"), ok: true },
        },
      ],
    },
  ],
};

function generated() {
  return wireContracts(app, {
    contracts: { "/ledger/add": { required: ["item", "amount"] } },
  });
}

function branchAndConflictWire() {
  return wireContracts(branchAndConflictApp, {
    contracts: {
      "/choose": { required: ["kind", "value"] },
      "/conflict": { required: ["value"] },
      "/view": { required: ["value"] },
    },
  });
}

function dependentOptionalWire() {
  const dependent: AppIR = {
    unlowered: [],
    views: [],
    formers: [
      {
        name: "the dependent rows ()",
        ins: [],
        bindings: ["discussion", "response"],
        promise: "one",
        body: {
          node: "record",
          where: [
            {
              op: "whether",
              query: { concept: "Ledger", query: "_current" },
              in: {},
              out: { discussion: variable("discussion") },
            },
          ],
          entries: {
            discussion: { node: "leaf", var: "discussion" },
            responses: {
              node: "each",
              from: {
                op: "find",
                query: { concept: "Ledger", query: "_responses" },
                in: { discussion: variable("discussion") },
                out: { text: variable("text") },
              },
              as: { node: "record", entries: { text: { node: "leaf", var: "text" } } },
            },
          },
        },
      },
    ],
    reactions: [
      {
        name: "DependentRows",
        when: [
          {
            kind: "action",
            concept: "RequestBoundary",
            action: "request",
            input: { path: "/dependent", requestId: variable("requestId") },
            output: {},
          },
        ],
        where: [],
        then: [
          {
            kind: "request",
            concept: "RequestBoundary",
            action: "respond",
            input: {
              requestId: variable("requestId"),
              result: { $former: { name: "the dependent rows ()", in: {} } },
            },
          },
        ],
      },
    ],
  };
  return wireContracts(dependent);
}

function field(type: WireType, key: string): WireType {
  if (type.kind !== "object") throw new Error(`${key} is not inside an object wire type.`);
  const found = type.fields.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`No ${key} field in the wire type.`);
  return found.type;
}

describe("endpoint wire provenance", () => {
  test("follows action inputs and outputs through a lowered endpoint chain", () => {
    const add = generated().endpoints.find((endpoint) => endpoint.path === "/ledger/add")!;
    expect(add.input).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "amount",
          type: {
            kind: "reference",
            allOf: [
              {
                source: "action-input",
                concept: "Ledger",
                member: "add",
                path: ["amount"],
              },
            ],
          },
        },
        {
          key: "item",
          type: {
            kind: "reference",
            allOf: [
              {
                source: "action-input",
                concept: "Ledger",
                member: "add",
                path: ["item"],
              },
            ],
          },
        },
      ],
    });
    expect(add.output).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "entry",
          type: {
            kind: "reference",
            allOf: [
              {
                source: "action-output",
                concept: "Ledger",
                member: "add",
                path: ["entry"],
              },
            ],
          },
        },
      ],
    });
  });

  test("carries query fields, aliases, and optional absence through a former", () => {
    const list = generated().endpoints.find((endpoint) => endpoint.path === "/ledger/list")!;
    const rows = field(list.output, "rows");
    if (rows.kind !== "array") throw new Error("rows is not an array wire type.");
    expect(field(rows.of, "amount")).toMatchObject({
      kind: "reference",
      allOf: [
        {
          source: "query-output",
          concept: "Ledger",
          member: "_rows",
          path: ["amount"],
        },
      ],
    });
    expect(field(rows.of, "label")).toMatchObject({
      kind: "union",
      of: [
        {
          kind: "reference",
          allOf: [
            {
              source: "query-output",
              concept: "Ledger",
              member: "_labelOf",
              path: ["label"],
            },
          ],
        },
        { kind: "literal", value: null },
      ],
    });
  });

  test("optional inputs suppress nested collections without nulling their row fields", () => {
    const output = dependentOptionalWire().endpoints.find(
      (endpoint) => endpoint.path === "/dependent",
    )!.output;
    const result = field(output, "result");
    expect(field(result, "discussion")).toMatchObject({
      kind: "union",
      of: [{ kind: "reference" }, { kind: "literal", value: null }],
    });
    const responses = field(result, "responses");
    if (responses.kind !== "array") throw new Error("responses is not an array wire type.");
    expect(field(responses.of, "text")).toMatchObject({
      kind: "reference",
      allOf: [
        {
          source: "query-output",
          concept: "Ledger",
          member: "_responses",
          path: ["text"],
        },
      ],
    });
  });

  test("unions separate endpoint branches and intersects one variable's constraints", () => {
    const wire = branchAndConflictWire();
    const choose = wire.endpoints.find((endpoint) => endpoint.path === "/choose")!;
    expect(field(choose.input, "value")).toMatchObject({
      kind: "union",
      of: [
        {
          kind: "reference",
          allOf: [
            {
              source: "action-input",
              concept: "Ledger",
              member: "rename",
              path: ["name"],
            },
          ],
        },
        {
          kind: "reference",
          allOf: [
            {
              source: "action-input",
              concept: "Ledger",
              member: "setAmount",
              path: ["amount"],
            },
          ],
        },
      ],
    });
    expect(field(choose.input, "kind")).toMatchObject({
      kind: "union",
      of: [
        { kind: "literal", value: "text" },
        { kind: "literal", value: "amount" },
      ],
    });

    const conflict = wire.endpoints.find((endpoint) => endpoint.path === "/conflict")!;
    expect(field(conflict.input, "value")).toMatchObject({
      kind: "reference",
      allOf: [
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
      ],
    });
  });

  test("unions constraints that escape through alternative view slots", () => {
    const view = branchAndConflictWire().endpoints.find((endpoint) => endpoint.path === "/view")!;
    expect(field(view.input, "value")).toMatchObject({
      kind: "union",
      of: [
        {
          kind: "reference",
          allOf: [
            {
              source: "query-input",
              concept: "Ledger",
              member: "_text",
              path: ["text"],
            },
          ],
        },
        {
          kind: "reference",
          allOf: [
            {
              source: "query-input",
              concept: "Ledger",
              member: "_amount",
              path: ["amount"],
            },
          ],
        },
      ],
    });
  });

  test("keeps computation constraints intersected and standard relations unanchored", () => {
    const env: Parameters<typeof applyOpsProvenance>[0] = new Map();
    applyOpsProvenance(
      env,
      [
        {
          op: "holds",
          computation: "lt",
          in: { left: variable("value"), right: 10 },
        },
        {
          op: "compute",
          computation: "normalize",
          in: { value: variable("value") },
          out: "normalized",
        },
        {
          op: "compute",
          computation: "accepts",
          in: { candidate: variable("value") },
          out: "accepted",
        },
      ],
      new Map(),
      "ComputationConstraints where",
    );

    expect(referenceOf(env.get("value"))).toMatchObject({
      alternatives: [
        [
          {
            source: "computation-input",
            computation: "accepts",
            path: ["candidate"],
          },
          {
            source: "computation-input",
            computation: "normalize",
            path: ["value"],
          },
        ],
      ],
    });
  });

  test("follows vocabulary computation inputs and outputs", () => {
    const computationApp: AppIR = {
      unlowered: [],
      views: [],
      formers: [],
      reactions: [
        {
          name: "RegisterAdmin",
          when: [
            {
              kind: "action",
              concept: "RequestBoundary",
              action: "request",
              input: {
                path: "/setup/register-admin",
                setupSecret: variable("setupSecret"),
                requestId: variable("requestId"),
              },
              output: {},
            },
          ],
          where: [
            {
              op: "compute",
              computation: "setupSecretMatches",
              in: { secret: variable("setupSecret") },
              out: "valid",
            },
          ],
          then: [
            {
              kind: "request",
              concept: "RequestBoundary",
              action: "respond",
              input: { requestId: variable("requestId"), valid: variable("valid") },
            },
          ],
        },
      ],
    };
    const endpoint = wireContracts(computationApp, {
      contracts: { "/setup/register-admin": { required: ["setupSecret"] } },
    }).endpoints[0];

    expect(field(endpoint.input, "setupSecret")).toMatchObject({
      kind: "reference",
      allOf: [
        {
          source: "computation-input",
          computation: "setupSecretMatches",
          path: ["secret"],
        },
      ],
    });
    expect(field(endpoint.output, "valid")).toMatchObject({
      kind: "reference",
      allOf: [
        {
          source: "computation-output",
          computation: "setupSecretMatches",
          path: [],
        },
      ],
    });
  });
});
