/**
 * The specification renderer gives every IR node kind one rendering rule,
 * and the rendered spec never reads as more complete than it is: unwritten
 * prose is marked, unlowered reactions are listed, opaque computations say so.
 * The full-app rendering is pinned by a golden file (the stitch spec).
 */
import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import { when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import type { Frames } from "@sync-engine/internal/reads/frames";
import type { ReactionIR, WhereOpIR } from "@sync-engine/internal/reads/ir";
import { renderApp, renderReaction, renderWhereOp } from "@sync-engine/internal/reads/render";
import { inventoryOf } from "@sync-engine/internal/reactions/concepts/introspect";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import type { StepNode } from "@sync-engine/internal/reactions/types";
import { ButtonConcept, CounterConcept, mockRefs } from "../reactions/mocks.ts";

// ── renderReaction ─────────────────────────────────────────────────────────────

describe("renderReaction", () => {
  test("renders a bare success trigger and one request", () => {
    const reaction: ReactionIR = {
      name: "RecordCompletedTodo",
      when: [
        {
          kind: "action",
          concept: "Todo",
          action: "complete",
          posture: "returned",
          input: { id: { $var: "id" } },
          output: { id: { $var: "id" } },
        },
      ],
      where: [],
      then: [
        {
          kind: "request",
          concept: "Audit",
          action: "record",
          input: { message: { $var: "id" } },
        },
      ],
    };
    expect(renderReaction(reaction)).toBe(
      ["when Todo.complete (id)", "then", "  Audit.record (message: id)"].join("\n"),
    );
  });

  test("renders deferred timing between the trigger and conditions", () => {
    const reaction: ReactionIR = {
      name: "AfterWork",
      when: [
        {
          kind: "action",
          concept: "Work",
          action: "start",
          input: {},
          output: {},
        },
      ],
      deferred: true,
      where: [],
      then: [{ kind: "request", concept: "Work", action: "finish", input: {} }],
    };

    expect(renderReaction(reaction)).toBe(
      ["when Work.start ()", "at the flow's settlement frontier", "then", "  Work.finish ()"].join(
        "\n",
      ),
    );
  });

  test("posture and provenance pins render as words, roles merge input and output", () => {
    const reaction: ReactionIR = {
      name: "Chained#2",
      when: [
        {
          kind: "action",
          concept: "Payment",
          action: "charge",
          posture: "refused",
          by: "OnCheckout",
          input: { id: { $var: "item" }, amount: 100 },
          output: { id: { $var: "item" }, receipt: { $var: "receipt" } },
        },
      ],
      where: [],
      then: [{ kind: "request", concept: "Inventory", action: "release", input: {} }],
    };
    expect(renderReaction(reaction)).toBe(
      [
        "when refused Payment.charge (id: item, amount: 100, receipt), asked by OnCheckout",
        "then",
        "  Inventory.release ()",
      ].join("\n"),
    );
  });

  test("a role both sides claim with different patterns is qualified, never dropped", () => {
    const reaction: ReactionIR = {
      name: "Conflict",
      when: [
        {
          kind: "action",
          concept: "A",
          action: "request",
          input: { id: { $var: "asked" } },
          output: { id: { $var: "made" } },
        },
      ],
      where: [],
      then: [{ kind: "request", concept: "B", action: "note", input: {} }],
    };
    expect(renderReaction(reaction)).toContain("when A.request (id: asked, result.id: made)");
  });

  test("a channel trigger reads as a sentence, with its loop-guard visible", () => {
    const reaction: ReactionIR = {
      name: "DeliverRefusalToAsker",
      when: [
        {
          kind: "channel",
          channel: "refused",
          pattern: { refusal: { $var: "refusal" } },
          except: ["RequestBoundary"],
        },
      ],
      where: [
        {
          op: "earlier",
          when: {
            kind: "action",
            concept: "RequestBoundary",
            action: "request",
            input: { requestId: { $var: "requestId" } },
            output: {},
          },
        },
      ],
      then: [
        {
          kind: "request",
          concept: "RequestBoundary",
          action: "respond",
          input: { requestId: { $var: "requestId" }, error: { $var: "refusal" } },
        },
      ],
    };
    expect(renderReaction(reaction)).toBe(
      [
        "when any action is refused (refusal), except RequestBoundary",
        "where",
        "  earlier, RequestBoundary.request (requestId)",
        "then",
        "  RequestBoundary.respond (requestId, error: refusal)",
      ].join("\n"),
    );
  });

  test("an empty channel pattern drops its parens", () => {
    const reaction: ReactionIR = {
      name: "OnAnyFault",
      when: [{ kind: "channel", channel: "faulted", pattern: {}, except: [] }],
      where: [],
      then: [{ kind: "request", concept: "Ops", action: "page", input: {} }],
    };
    expect(renderReaction(reaction)).toContain("when any action is faulted\n");
  });

  test("renders a joint trigger as several consumed occurrences", () => {
    const clause = (concept: string): ReactionIR["when"][number] => ({
      kind: "action",
      concept,
      action: "done",
      input: {},
      output: {},
    });
    const reaction: ReactionIR = {
      name: "Joint",
      when: [clause("A"), clause("B")],
      where: [],
      then: [{ kind: "request", concept: "C", action: "go", input: {} }],
    };
    expect(renderReaction(reaction)).toBe(
      ["when A.done ()", "and jointly when B.done ()", "then", "  C.go ()"].join("\n"),
    );
  });

  test("matchers render as they read: one of, a regexp, an opaque marker", () => {
    const reaction: ReactionIR = {
      name: "Matchers",
      when: [
        {
          kind: "action",
          concept: "Receiving",
          action: "receive",
          input: {
            path: { $regexp: { source: "^/api", flags: "" } },
            kind: { $oneOf: ["get", "put"] },
            guarded: { $is: "custom predicate" },
          },
          output: {},
        },
      ],
      where: [],
      then: [{ kind: "request", concept: "B", action: "note", input: {} }],
    };
    const rendered = renderReaction(reaction);
    expect(rendered).toContain("path: /^/api/");
    expect(rendered).toContain('kind: one of "get" or "put"');
    expect(rendered).toContain("guarded: «opaque matcher: custom predicate»");
  });
});

// ── renderWhereOp: one condition sentence per op kind ──────────────────────

describe("renderWhereOp", () => {
  const query = { concept: "Work", query: "_get" };

  test("a plain line, no, and whether render as distinct conditions", () => {
    const find: WhereOpIR = {
      op: "find",
      query,
      in: { id: { $var: "previous" } },
      out: { title: { $var: "title" }, id: { $var: "itemId" } },
    };
    expect(renderWhereOp(find)).toBe("Work._get (id: previous) has (title, id: itemId)");
    expect(renderWhereOp({ ...find, op: "whether" })).toBe(
      "whether Work._get (id: previous) has (title, id: itemId)",
    );
    expect(renderWhereOp({ op: "no", query, in: { id: { $var: "id" } }, out: {} })).toBe(
      "no Work._get (id)",
    );
    expect(renderWhereOp({ ...find, out: {}, not: { author: { $var: "user" } } })).toBe(
      "Work._get (id: previous) and not (author: user)",
    );
  });

  test("a read with nothing to bind stops at the question — the bare call", () => {
    expect(renderWhereOp({ op: "find", query, in: { id: { $var: "id" } }, out: {} })).toBe(
      "Work._get (id)",
    );
  });

  test("built-in relations render as condition sentences", () => {
    const cases: Array<[WhereOpIR, string]> = [
      [
        { op: "holds", computation: "lt", in: { left: { $var: "count" }, right: 10 } },
        "count is less than 10",
      ],
      [
        { op: "holds", computation: "le", in: { left: { $var: "count" }, right: 10 } },
        "count is at most 10",
      ],
      [
        { op: "holds", computation: "gt", in: { left: { $var: "count" }, right: 0 } },
        "count is greater than 0",
      ],
      [
        { op: "holds", computation: "ge", in: { left: { $var: "count" }, right: 0 } },
        "count is at least 0",
      ],
      [
        {
          op: "holds",
          computation: "among",
          in: { value: { $var: "person" }, collection: { $var: "editors" } },
        },
        "person is among editors",
      ],
    ];
    for (const [op, sentence] of cases) expect(renderWhereOp(op)).toBe(sentence);
  });

  test("a registered domain computation renders as its own sentence-with-slots", () => {
    expect(
      renderWhereOp({
        op: "holds",
        computation: "matches",
        in: { key: { $var: "key" }, attempt: { $var: "attempt" } },
      }),
    ).toBe("matches (key, attempt)");
  });

  test("compute renders as a named vocabulary calculation", () => {
    expect(
      renderWhereOp({
        op: "compute",
        computation: "slugOf",
        in: { title: { $var: "title" } },
        out: "slug",
      }),
    ).toBe("slug is slugOf (title)");
  });

  test("compute renders projected outputs as named slots", () => {
    expect(
      renderWhereOp({
        op: "compute",
        computation: "describe",
        in: { value: { $var: "value" } },
        out: { label: { $var: "label" }, rank: { $var: "rank" } },
      }),
    ).toBe("(label, rank) is describe (value)");
  });

  test("custom renders as an explicit opaque line", () => {
    expect(
      renderWhereOp({
        op: "custom",
        fnRef: "joinNames",
        opaque: true,
        in: ["first", "last"],
        out: ["full"],
      }),
    ).toBe(
      'custom computation "joinNames" reads (first, last) binds (full) — opaque code, not data',
    );
  });
});

// ── Registered concept inventory ──────────────────────────────────────────

describe("inventoryOf", () => {
  test("reads action names and query names from a concept", () => {
    class MiniConcept {
      static readonly queries = { _get: "optional", _list: "many" } as const;
      doThing({ id }: { id: string }) {
        return { id, done: true };
      }
      _get({ id }: { id: string }): { id: string }[] {
        return [{ id }];
      }
      _list(_: Record<string, never>): { id: string }[] {
        return [];
      }
    }

    const inventory = inventoryOf(new MiniConcept());
    expect(inventory.name).toBe("Mini");
    expect(inventory.actions).toContainEqual({ name: "doThing", roles: ["id"] });
    expect(inventory.queries).toContainEqual({ name: "_get", roles: ["id"], returns: "optional" });
    expect(inventory.queries).toContainEqual({ name: "_list", roles: [], returns: "many" });
    expect(inventory.purpose).toBeUndefined();
  });

  test("authored purpose and principle prose is carried when the class declares it", () => {
    class GreetingConcept {
      static readonly purpose = "Let a greeting be spoken.";
      static readonly principle = "Ada greets Sam, and the application records the greeting.";
      greet({ to }: { to: string }) {
        return { to };
      }
    }
    const inventory = inventoryOf(new GreetingConcept());
    expect(inventory.purpose).toBe("Let a greeting be spoken.");
    expect(inventory.principle).toBe("Ada greets Sam, and the application records the greeting.");
  });

  test("inventories inherited protocol methods without publishing injected callbacks", () => {
    class BaseConcept {
      zeta(_: Record<string, never>) {
        return {};
      }
      _zeta(_: Record<string, never>) {
        return [];
      }
    }
    class CompleteConcept extends BaseConcept {
      constructor(readonly freshID = () => "generated") {
        super();
      }
      alpha(_: Record<string, never>) {
        return {};
      }
      _alpha(_: Record<string, never>) {
        return [];
      }
    }

    const inventory = inventoryOf(new CompleteConcept());
    expect(inventory).toMatchObject({
      actions: [
        { name: "alpha", roles: [] },
        { name: "zeta", roles: [] },
      ],
      queries: [
        { name: "_alpha", roles: [] },
        { name: "_zeta", roles: [] },
      ],
    });
    expect(inventory.actions.map(({ name }) => name)).not.toContain("freshID");
  });
});

// ── The whole spec, pinned ─────────────────────────────────────────────────

describe("renderApp", () => {
  function mockEngine(): Reacting {
    const engine = new Reacting();
    engine.logging = Logging.OFF;
    engine.instrument({
      Counter: new CounterConcept(),
      Button: new ButtonConcept(),
    });
    engine.register({
      CounterClicked: ({ kind }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds()).then(mockRefs.Counter.increment({})),
      ClickAndNotify: ({ kind }: Vars) => {
        const increment = mockRefs.Counter.increment({}) as StepNode;
        increment.stepName = "Inc";
        return when(mockRefs.Button.clicked({ kind }).responds()).then(increment as never);
      },
    });
    return engine;
  }

  test("a rendered app contains its registered reactions", () => {
    const spec = mockEngine().renderApp("MockApp");
    expect(spec).toContain("CounterClicked");
    expect(spec).toContain("Inc");
  });

  test("an unlowered reaction renders its authored identity and every coverage location", () => {
    const rendered = renderApp({
      title: "Covered local application",
      concepts: [],
      app: {
        reactions: [],
        views: [],
        formers: [],
        unlowered: [
          {
            name: "LocalRuntimeReaction",
            authored: { kind: "reaction", identity: "Forum.LocalReaction" },
            reason: "a closure keeps executable behavior local",
            known: { when: [], where: [], then: [], patterns: [] },
          },
        ],
      },
      design: {
        checked: true,
        sources: [
          { id: "document-1", path: "../design/forum.md", title: "Forum design" },
          { id: "document-2", path: "../design/access.md", title: "Access design" },
        ],
        declarations: [
          {
            kind: "reaction",
            identity: "Forum.LocalReaction",
            runtimeNames: ["LocalRuntimeReaction"],
            coverage: [
              { source: "document-1", line: 12, column: 4 },
              { source: "document-2", line: 27, column: 2 },
            ],
          },
        ],
        concepts: [],
        computations: [],
      },
    });

    expect(rendered).toContain("### LocalRuntimeReaction");
    expect(rendered).toContain("Authored path: `Forum.LocalReaction`.");
    expect(rendered).toContain("- Covered by [Forum design](../design/forum.md), line 12.");
    expect(rendered).toContain("- Covered by [Access design](../design/access.md), line 27.");
  });

  test("a reaction that stayed a pipeline is listed with its reason, never dropped", () => {
    const engine = new Reacting();
    engine.logging = Logging.OFF;
    engine.instrument({
      Counter: new CounterConcept(),
    });
    engine.register({
      JustCount: (_: Vars) =>
        when(mockRefs.Counter.increment({}).responds()).then(mockRefs.Counter.decrement({})),
    });
    expect(engine.renderApp("Test")).not.toContain("Reactions represented only by executable code");

    const WithTransform = (_: Vars) => {
      const transformed = mockRefs.Counter.decrement({}) as StepNode;
      transformed.transform = (frames: Frames) => frames.map((frame) => ({ ...frame }));
      return when(mockRefs.Counter.increment({}).responds()).then(transformed as never);
    };
    engine.register({ WithTransform });

    const spec = engine.renderApp("Test");
    expect(spec).toContain("Reactions represented only by executable code");
    expect(spec).toContain("`WithTransform` — a step transform in the pipeline");
  });
});
