import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Generated wire contracts. Response mappings and formers provide output
 * shapes. Input contracts and request literals provide input types. Explicit
 * endpoint errors and declared action refusals provide error unions. An
 * `earlier` condition associates a continuation with its original path.
 */

import { describe, expect, test } from "vite-plus/test";
import {
  request,
  former,
  inventoryOf,
  each,
  no,
  view,
  where,
  whether,
  vocabulary,
  when,
} from "@sync-engine/internal/reactions";
import type { Vars } from "@sync-engine/internal/reactions";
import {
  assemble,
  endpoint,
  fail,
  receive,
  renderWireTypes,
  respond,
  wireContracts,
} from "@sync-engine/internal/boundary";

class LedgerConcept {
  static readonly outcomes = {
    add: { refusals: ["NEGATIVE_AMOUNT"] },
  };
  private rows: { entry: string; item: string; amount: number }[] = [];
  private labels: { item: string; label: string }[] = [];

  add({ item, amount }: { item: string; amount: number }) {
    const entry = `e${this.rows.length + 1}`;
    this.rows.push({ entry, item, amount });
    return { entry };
  }
  _rows(_: Record<string, never>) {
    return this.rows;
  }
  _labelOf({ item }: { item: string }) {
    return this.labels.filter((l) => l.item === item);
  }
}

function setup() {
  const ledger = new LedgerConcept();
  const words = vocabulary({ concepts: { Ledger: LedgerConcept }, computations: {} });
  const { Ledger } = words.concepts;

  const labelOf = view("the label of (item)", ({ item }, { label }, _bindings) =>
    where(lineOf({ query: Ledger._labelOf }, { item }).is({ label })),
  ).optional();

  const theRows = former("the ledger rows ()", (_inputs, { entry, item, amount, label }) =>
    each(lineOf({ query: Ledger._rows }, {}).is({ entry, item, amount }))
      .where(whether(labelOf({ item }).is({ label })))
      .form({ entry, item, amount, label }),
  );

  const theLatest = former("the latest entry ()", (_inputs, { entry }) =>
    each(lineOf({ query: Ledger._rows }, {}).is({ entry })).first(entry),
  );
  const composition = {
    LedgerAdd: endpoint(
      "/ledger/add",
      ({ session, item, amount, entry }: Vars) =>
        receive({ session, item, amount })
          .then(request(Ledger.add, { item, amount }, { entry }))
          .then(respond({ entry })),
      { input: { required: ["session", "item", "amount"], defaults: { note: null } } },
    ),
    LedgerAddForbidden: endpoint("/ledger/add", ({ session, item, amount }: Vars) =>
      receive({ session, item, amount }).then(fail("FORBIDDEN")),
    ),
    LedgerList: endpoint("/ledger/list", () => receive({}).then(respond({ rows: theRows({}) }))),
    LedgerLatest: endpoint("/ledger/latest", () =>
      receive({}).then(respond({ latest: theLatest({}) })),
    ),
    LedgerLabel: endpoint("/ledger/label", ({ item, label }: Vars) =>
      receive({ item }).then(
        where(labelOf({ item }).is({ label })).then(respond({ label })).named("found"),
        where(no(labelOf({ item })))
          .then(respond({ label: null }))
          .named("missing"),
      ),
    ),
    LedgerKnownLabel: endpoint("/ledger/known-label", ({ item, label }: Vars) =>
      receive({ item, label })
        .where(whether(labelOf({ item }).is({ label })))
        .then(respond({ label })),
    ),
    LedgerPair: endpoint("/ledger/pair", () =>
      receive({}).then(
        where(labelOf({ item: "x" }).is({ label: "a" }))
          .then(respond({ left: null, right: "b" }))
          .named("a"),
        where(labelOf({ item: "x" }).is({ label: "b" }))
          .then(respond({ left: "a", right: null }))
          .named("b"),
      ),
    ),
    FeedCreated: endpoint("/ledger/feed", () =>
      receive({ sort: "created" }).then(respond({ rows: [], order: "created" })),
    ),
    FeedActivity: endpoint("/ledger/feed", () =>
      receive({ sort: "activity" }).then(respond({ rows: [], order: "activity" })),
    ),
    theRows,
    theLatest,
    labelOf,
  };

  const assembled = assemble({
    vocabulary: words,
    instances: { Ledger: ledger },
    composition,
  });

  // This boundary reaction has no literal path, so its error applies to every
  // endpoint.
  const boundary = assembled.boundaryActions;
  const guardReactions = {
    InvalidSession: ({ session, requestId }: Vars) =>
      when(boundary.request, { session, requestId }).then(
        request(boundary.respond, { error: "INVALID_SESSION", requestId }),
      ),
  };
  assembled.engine.register(guardReactions);

  const wire = wireContracts(assembled.engine.exportReactions(), {
    contracts: assembled.contracts,
    inventories: [inventoryOf(ledger)],
  });
  return { wire };
}

describe("wire contracts", () => {
  test("paths derive from triggers and inputs combine contracts with request literals", () => {
    const { wire } = setup();
    const paths = wire.endpoints.map((e) => e.path);
    expect(paths).toEqual([
      "/ledger/add",
      "/ledger/feed",
      "/ledger/known-label",
      "/ledger/label",
      "/ledger/latest",
      "/ledger/list",
      "/ledger/pair",
    ]);

    const add = wire.endpoints.find((e) => e.path === "/ledger/add")!;
    expect(add.input).toMatchObject({
      kind: "object",
      fields: [
        { key: "amount", type: { kind: "reference" } },
        { key: "item", type: { kind: "reference" } },
        { key: "note", type: { kind: "json" }, optional: true },
        { key: "session", type: { kind: "json" } },
      ],
    });

    const feed = wire.endpoints.find((e) => e.path === "/ledger/feed")!;
    expect(feed.input).toEqual({
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
    });
  });

  test("errors union fail literals, asked actions' declared refusals, and INVALID_INPUT", () => {
    const { wire } = setup();
    const add = wire.endpoints.find((e) => e.path === "/ledger/add")!;
    expect(add.errors).toEqual(["FORBIDDEN", "INVALID_INPUT", "NEGATIVE_AMOUNT"]);
    expect(wire.appWide).toEqual(["INVALID_SESSION"]);
  });

  test("former outputs derive structurally: arrays, records, nullability", () => {
    const { wire } = setup();

    const list = wire.endpoints.find((e) => e.path === "/ledger/list")!;
    expect(list.output).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "rows",
          type: {
            kind: "array",
            of: {
              kind: "object",
              fields: [
                { key: "amount", type: { kind: "reference" } },
                { key: "entry", type: { kind: "reference" } },
                { key: "item", type: { kind: "reference" } },
                {
                  key: "label",
                  type: {
                    kind: "union",
                    of: [{ kind: "reference" }, { kind: "literal", value: null }],
                  },
                },
              ],
            },
          },
        },
      ],
    });

    const latest = wire.endpoints.find((e) => e.path === "/ledger/latest")!;
    expect(latest.output).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "latest",
          type: { kind: "union", of: [{ kind: "reference" }, { kind: "literal", value: null }] },
        },
      ],
    });

    const label = wire.endpoints.find((e) => e.path === "/ledger/label")!;
    expect(label.output).toMatchObject({
      kind: "object",
      fields: [
        {
          key: "label",
          type: {
            kind: "union",
            of: [{ kind: "reference" }, { kind: "literal", value: null }],
          },
        },
      ],
    });

    const knownLabel = wire.endpoints.find((e) => e.path === "/ledger/known-label")!;
    expect(knownLabel.output).toMatchObject({
      kind: "object",
      fields: [{ key: "label", type: { kind: "reference" } }],
    });

    const pair = wire.endpoints.find((e) => e.path === "/ledger/pair")!;
    expect(pair.output).toEqual({
      kind: "union",
      of: [
        {
          kind: "object",
          fields: [
            { key: "left", type: { kind: "literal", value: null } },
            { key: "right", type: { kind: "literal", value: "b" } },
          ],
        },
        {
          kind: "object",
          fields: [
            { key: "left", type: { kind: "literal", value: "a" } },
            { key: "right", type: { kind: "literal", value: null } },
          ],
        },
      ],
    });
  });

  test("a continuation keeps the path of its original request", () => {
    const { wire } = setup();
    const add = wire.endpoints.find((e) => e.path === "/ledger/add")!;
    // LedgerAdd#2 contains the response. Its `earlier` condition links it to
    // the original `/ledger/add` request.
    expect(add.output).toMatchObject({
      kind: "object",
      fields: [{ key: "entry", type: { kind: "reference" } }],
    });
  });

  test("renderWireTypes emits a client-pluggable module", () => {
    const { wire } = setup();
    const source = renderWireTypes(wire);
    expect(source).toContain('export type AppWideError = "INVALID_SESSION";');
    expect(source).toContain('"/ledger/add": {');
    expect(source).toContain(
      'error: { error: AppWideError | "FORBIDDEN" | "INVALID_INPUT" | "NEGATIVE_AMOUNT" };',
    );
    expect(source).toContain('"sort": "activity" | "created";');
    expect(source).toContain("export type Json =");
  });

  test("renderWireTypes appends a named projection under shared helpers", () => {
    const { wire } = setup();
    const logical = renderWireTypes(wire, { moduleName: "ApplicationWire" });
    const projected = renderWireTypes(wire, {
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

  test("an empty-array literal produces never[]", () => {
    const StubList = endpoint("/stub/list", ({ session }: Vars) =>
      receive({ session }).then(respond({ uses: [] })),
    );
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { StubList },
    });
    const wire = wireContracts(app.engine.exportReactions());
    const source = renderWireTypes(wire);
    expect(source).toContain('"uses": never[];');
  });
});
