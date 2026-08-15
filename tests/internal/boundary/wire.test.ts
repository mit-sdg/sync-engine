/**
 * Generated wire contracts. Response mappings and formers provide output
 * shapes. Input contracts and request literals provide input types. Explicit
 * endpoint errors and declared action refusals provide error unions. An
 * `earlier` condition associates a continuation with its original path.
 */

import { describe, expect, test } from "vite-plus/test";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/advanced";
import { each, former, no, reaction, view, when, where, whether } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { wireContracts } from "@sync-engine/tooling";
import { inventoryOf } from "@sync-engine/internal/reactions/concepts/introspect";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { Requesting } from "@sync-engine/internal/boundary/invocation/invoke";
import type { AppIR } from "@sync-engine/internal/reads/ir";

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
  const { RequestBoundary } = vocabulary({
    concepts: { RequestBoundary: Requesting },
  }).concepts;

  const labelOf = view("the label of (item)", ({ item }, { label }, _bindings) =>
    where(Ledger._labelOf({ item }).is({ label })),
  ).optional();

  const theRows = former("the ledger rows ()", (_inputs, { entry, item, amount, label }) =>
    each(Ledger._rows({}).is({ entry, item, amount }))
      .where(whether(labelOf({ item }).is({ label })))
      .form({ entry, item, amount, label }),
  );

  const theLatest = former("the latest entry ()", (_inputs, { entry }) =>
    each(Ledger._rows({}).is({ entry })).first(entry),
  );
  const composition = {
    LedgerAdd: endpoint(
      "/ledger/add",
      ({ session, item, amount, entry }: Vars) =>
        receive({ session, item, amount })
          .then(Ledger.add({ item, amount }).responds({ entry }))
          .then(respond({ entry })),
      { input: { required: ["session", "item", "amount"], defaults: { note: null } } },
    ),
    LedgerAddForbidden: endpoint("/ledger/add", ({ session, item, amount }: Vars) =>
      receive({ session, item, amount }).then(respond({ error: "FORBIDDEN" })),
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
  const guardReactions = {
    InvalidSession: ({ session, requestId }: Vars) =>
      when(RequestBoundary.request({ session, requestId }).responds()).then(
        RequestBoundary.respond({ error: "INVALID_SESSION", requestId }),
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

  test("includes refusals from causal surrounding and transitive reactions only", () => {
    class SelectingConcept {
      choose(_: { room: string }) {
        return { selection: "selection-1" };
      }
    }
    class DiscussingConcept {
      static readonly outcomes = { open: { refusals: ["DISCUSSION_ALREADY_OPEN"] } };
      open(_: { subject: string }) {
        return { discussion: "discussion-1" };
      }
    }
    class AlertingConcept {
      static readonly outcomes = { raise: { refusals: ["ALERT_BLOCKED"] } };
      raise(_: { discussion: string }) {
        return { alert: "alert-1" };
      }
    }
    class ArchivingConcept {
      static readonly outcomes = { archive: { refusals: ["ARCHIVE_LOCKED"] } };
      archive(_: Record<string, never>) {
        return {};
      }
    }

    const selecting = new SelectingConcept();
    const discussing = new DiscussingConcept();
    const alerting = new AlertingConcept();
    const archiving = new ArchivingConcept();
    const words = vocabulary({
      concepts: {
        Selecting: SelectingConcept,
        Discussing: DiscussingConcept,
        Alerting: AlertingConcept,
        Archiving: ArchivingConcept,
      },
      computations: {},
    });
    const { Selecting, Discussing, Alerting, Archiving } = words.concepts;
    const ChooseMitigation = endpoint("/rooms/choose-mitigation", ({ room, selection }: Vars) =>
      receive({ room })
        .then(Selecting.choose({ room }).responds({ selection }))
        .then(respond({ selection })),
    );
    const Archive = endpoint("/archive", () =>
      receive({})
        .then(Archiving.archive({}))
        .then(respond({ archived: true })),
    );
    const SelectedMitigationOpensDiscussion = reaction(({ selection, discussion }: Vars) =>
      when(Selecting.choose({}).responds({ selection })).then(
        Discussing.open({ subject: selection }).responds({ discussion }),
      ),
    );
    const OpenDiscussionRaisesAlert = reaction(({ discussion }: Vars) =>
      when(Discussing.open({}).responds({ discussion })).then(Alerting.raise({ discussion })),
    );
    const app = assemble({
      vocabulary: words,
      instances: {
        Selecting: selecting,
        Discussing: discussing,
        Alerting: alerting,
        Archiving: archiving,
      },
      composition: {
        ChooseMitigation,
        Archive,
        SelectedMitigationOpensDiscussion,
        OpenDiscussionRaisesAlert,
      },
    });
    const wire = wireContracts(app.engine.exportReactions(), {
      inventories: [selecting, discussing, alerting, archiving].map(inventoryOf),
    });

    expect(wire.endpoints.find(({ path }) => path === "/rooms/choose-mitigation")?.errors).toEqual([
      "ALERT_BLOCKED",
      "DISCUSSION_ALREADY_OPEN",
    ]);
    expect(wire.endpoints.find(({ path }) => path === "/archive")?.errors).toEqual([
      "ARCHIVE_LOCKED",
    ]);
  });

  test("combines global and route seeds without widening app-wide errors", () => {
    const app = {
      reactions: [
        {
          name: "GlobalGuard",
          when: [
            {
              kind: "action",
              concept: "RequestBoundary",
              action: "request",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "GlobalPolicy", action: "check", input: {} }],
        },
        {
          name: "MixedRoute",
          when: [
            {
              kind: "action",
              concept: "RequestBoundary",
              action: "request",
              posture: "returned",
              input: { path: "/mixed" },
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "RouteWork", action: "start", input: {} }],
        },
        {
          name: "OtherRoute",
          when: [
            {
              kind: "action",
              concept: "RequestBoundary",
              action: "request",
              posture: "returned",
              input: { path: "/other" },
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "OtherWork", action: "start", input: {} }],
        },
        {
          name: "GlobalAndRouteWork",
          when: [
            {
              kind: "action",
              concept: "GlobalPolicy",
              action: "check",
              posture: "returned",
              input: {},
              output: {},
            },
            {
              kind: "action",
              concept: "RouteWork",
              action: "start",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "MixedRisk", action: "take", input: {} }],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    } satisfies AppIR;
    const wire = wireContracts(app, {
      inventories: [
        {
          name: "GlobalPolicy",
          actions: [{ name: "check", refusals: ["GLOBAL_DENIED"] }],
          queries: [],
        },
        {
          name: "MixedRisk",
          actions: [{ name: "take", refusals: ["MIXED_DENIED"] }],
          queries: [],
        },
      ],
    });

    expect(wire.appWide).toEqual(["GLOBAL_DENIED"]);
    expect(wire.endpoints.find(({ path }) => path === "/mixed")?.errors).toEqual(["MIXED_DENIED"]);
    expect(wire.endpoints.find(({ path }) => path === "/other")?.errors).toEqual([]);
  });

  test("requires distinct asked occurrences for duplicate trigger clauses", () => {
    const requestSeed = (name: string, path: string) => ({
      name,
      when: [
        {
          kind: "action" as const,
          concept: "RequestBoundary",
          action: "request",
          posture: "returned" as const,
          input: { path },
          output: {},
        },
      ],
      where: [],
      then: [{ kind: "request" as const, concept: "Work", action: "start", input: {} }],
    });
    const workTrigger = {
      kind: "action" as const,
      concept: "Work",
      action: "start",
      posture: "returned" as const,
      input: {},
      output: {},
    };
    const app = {
      reactions: [
        requestSeed("SingleWork", "/single"),
        requestSeed("FirstWork", "/double"),
        requestSeed("SecondWork", "/double"),
        {
          name: "NeedsTwoWorkOccurrences",
          when: [workTrigger, workTrigger],
          where: [],
          then: [{ kind: "request", concept: "Risk", action: "take", input: {} }],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    } satisfies AppIR;
    const wire = wireContracts(app, {
      inventories: [
        {
          name: "Risk",
          actions: [{ name: "take", refusals: ["TWO_REQUIRED"] }],
          queries: [],
        },
      ],
    });

    expect(wire.endpoints.find(({ path }) => path === "/single")?.errors).toEqual([]);
    expect(wire.endpoints.find(({ path }) => path === "/double")?.errors).toEqual(["TWO_REQUIRED"]);
  });

  test("propagates repeated relay firings from separate upstream occurrences", () => {
    const requestSeed = (name: string) => ({
      name,
      when: [
        {
          kind: "action" as const,
          concept: "RequestBoundary",
          action: "request",
          posture: "returned" as const,
          input: { path: "/relayed" },
          output: {},
        },
      ],
      where: [],
      then: [{ kind: "request" as const, concept: "Source", action: "emit", input: {} }],
    });
    const relayedTrigger = {
      kind: "action" as const,
      concept: "Relayed",
      action: "arrive",
      posture: "returned" as const,
      input: {},
      output: {},
    };
    const app = {
      reactions: [
        requestSeed("FirstSource"),
        requestSeed("SecondSource"),
        {
          name: "RelayEachSource",
          when: [
            {
              kind: "action",
              concept: "Source",
              action: "emit",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "Relayed", action: "arrive", input: {} }],
        },
        {
          name: "NeedsTwoRelays",
          when: [relayedTrigger, relayedTrigger],
          where: [],
          then: [{ kind: "request", concept: "Risk", action: "take", input: {} }],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    } satisfies AppIR;
    const wire = wireContracts(app, {
      inventories: [
        {
          name: "Risk",
          actions: [{ name: "take", refusals: ["RELAY_OVERLOAD"] }],
          queries: [],
        },
      ],
    });

    expect(wire.endpoints.find(({ path }) => path === "/relayed")?.errors).toEqual([
      "RELAY_OVERLOAD",
    ]);
  });

  test("saturates fan-in multiplicity without losing compression chains", () => {
    const requestSeed = (index: number) => ({
      name: `SourceSeed${index}`,
      when: [
        {
          kind: "action" as const,
          concept: "RequestBoundary",
          action: "request",
          posture: "returned" as const,
          input: { path: "/fan-in" },
          output: {},
        },
      ],
      where: [],
      then: [{ kind: "request" as const, concept: "Upstream", action: "emit", input: {} }],
    });
    const sourceTrigger = {
      kind: "action" as const,
      concept: "Source",
      action: "emit",
      posture: "returned" as const,
      input: {},
      output: {},
    };
    const pairTrigger = {
      kind: "action" as const,
      concept: "Pair",
      action: "complete",
      posture: "returned" as const,
      input: {},
      output: {},
    };
    const app = {
      reactions: [
        ...Array.from({ length: 6 }, (_, index) => requestSeed(index)),
        {
          name: "EmitSourceForEachUpstream",
          when: [
            {
              kind: "action",
              concept: "Upstream",
              action: "emit",
              posture: "returned",
              input: {},
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "Source", action: "emit", input: {} }],
        },
        {
          name: "CompleteEachSourcePair",
          when: [sourceTrigger, sourceTrigger],
          where: [],
          then: [{ kind: "request", concept: "Pair", action: "complete", input: {} }],
        },
        {
          name: "NeedsThreePairs",
          when: [pairTrigger, pairTrigger, pairTrigger],
          where: [],
          then: [{ kind: "request", concept: "Risk", action: "take", input: {} }],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    } satisfies AppIR;
    const wire = wireContracts(app, {
      inventories: [
        {
          name: "Risk",
          actions: [{ name: "take", refusals: ["PAIR_LIMIT"] }],
          queries: [],
        },
      ],
    });

    expect(wire.endpoints.find(({ path }) => path === "/fan-in")?.errors).toEqual(["PAIR_LIMIT"]);
  });

  test("saturates cyclic multiplicity without losing downstream reachability", () => {
    const pulseTrigger = {
      kind: "action" as const,
      concept: "Pulse",
      action: "tick",
      posture: "returned" as const,
      input: {},
      output: {},
    };
    const app = {
      reactions: [
        {
          name: "CycleSeed",
          when: [
            {
              kind: "action",
              concept: "RequestBoundary",
              action: "request",
              posture: "returned",
              input: { path: "/cycle" },
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "Pulse", action: "tick", input: {} }],
        },
        {
          name: "PulseCycle",
          when: [pulseTrigger],
          where: [],
          then: [{ kind: "request", concept: "Pulse", action: "tick", input: {} }],
        },
        {
          name: "NeedsThreePulses",
          when: [pulseTrigger, pulseTrigger, pulseTrigger],
          where: [],
          then: [{ kind: "request", concept: "Risk", action: "take", input: {} }],
        },
      ],
      views: [],
      formers: [],
      unlowered: [],
    } satisfies AppIR;
    const wire = wireContracts(app, {
      inventories: [
        {
          name: "Risk",
          actions: [{ name: "take", refusals: ["PULSE_LIMIT"] }],
          queries: [],
        },
      ],
    });

    expect(wire.endpoints.find(({ path }) => path === "/cycle")?.errors).toEqual(["PULSE_LIMIT"]);
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

  test("an empty-array literal remains an empty element union in wire IR", () => {
    const StubList = endpoint("/stub/list", ({ session }: Vars) =>
      receive({ session }).then(respond({ uses: [] })),
    );
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { StubList },
    });
    const wire = wireContracts(app.engine.exportReactions());
    expect(wire.endpoints[0]?.output).toEqual({
      kind: "object",
      fields: [
        {
          key: "uses",
          type: { kind: "array", of: { kind: "union", of: [] } },
        },
      ],
    });
  });

  test("orders punctuation and non-ASCII field names by ordinal code unit", () => {
    const fields = JSON.parse('{"é":1,"~":2,"a":3,"_":4,"A":5}');
    const Ordered = endpoint("/ordered", () => receive().then(respond(fields)));
    const app = assemble({
      vocabulary: vocabulary({ concepts: {}, computations: {} }),
      composition: { Ordered },
    });
    const ordered = wireContracts(app.engine.exportReactions()).endpoints[0];
    if (ordered.output.kind !== "object") throw new Error("expected object output");

    expect(ordered.output.fields.map(({ key }) => key)).toEqual(["A", "_", "a", "~", "é"]);
  });
});
