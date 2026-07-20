/**
 * The specification renderer gives every IR node kind one rendering rule,
 * and the rendered spec never reads as more complete than it is: unwritten
 * prose is marked, unlowered reactions are listed, opaque computations say so.
 * The full-app rendering is pinned by a golden file (the stitch spec).
 */
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  type Frames,
  inventoryOf,
  renderReaction,
  renderWhereOp,
  rolesOf,
  Logging,
  Reacting,
  when,
  type ReactionIR,
  type Vars,
  type WhereOpIR,
} from "@sync-engine/internal/reactions";
import { FocusConcept, HistoryConcept, WorkConcept } from "../../golden/stitch/concepts.ts";
import { makeStitchFormers, makeStitchReactions } from "../../golden/stitch/reactions.ts";

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
      ["when Todo.complete (id)", "then", "  request Audit.record (message: id)"].join("\n"),
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
        "  request Inventory.release ()",
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
        "  request RequestBoundary.respond (requestId, error: refusal)",
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
      ["when A.done ()", "and jointly when B.done ()", "then", "  request C.go ()"].join("\n"),
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
  test("actions carry observed roles and declared refusals; queries are listed", () => {
    const inventory = inventoryOf(new WorkConcept({ nextId: 1, items: [] }));
    expect(inventory.name).toBe("Work");
    expect(inventory.actions).toContainEqual({
      name: "activate",
      roles: ["id"],
      refusals: ["NOT_FOUND", "ALREADY_DONE", "ALREADY_ACTIVE"],
    });
    expect(inventory.actions).toContainEqual({ name: "pause", roles: ["id"] });
    expect(inventory.queries).toContainEqual({ name: "_get", roles: ["id"], returns: "optional" });
    // `_list(_)` takes nothing, and the reader can tell.
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

  test("rolesOf declines to guess", () => {
    expect(rolesOf(({ a, b }: { a: string; b: string }) => [a, b])).toEqual(["a", "b"]);
    expect(rolesOf((_: object) => 0)).toEqual([]);
    // Nested destructuring and positional parameters are not guessed at.
    expect(rolesOf((value: string) => value)).toBeUndefined();
  });
});

// ── The whole spec, pinned ─────────────────────────────────────────────────

describe("renderApp", () => {
  function stitchEngine(): Reacting {
    const engine = new Reacting();
    engine.logging = Logging.OFF;
    const { Work, Focus, History } = engine.instrument({
      Work: new WorkConcept({ nextId: 1, items: [] }),
      Focus: new FocusConcept({ current: null, sessions: [] }),
      History: new HistoryConcept({ entries: [] }),
    });
    engine.register(makeStitchReactions(Work, Focus, History));
    engine.declareFormers(...Object.values(makeStitchFormers(Work, Focus, History)));
    return engine;
  }

  test("the stitch spec matches its golden file", async () => {
    const golden = await readFile(
      new URL("../../golden/stitch/golden/spec.md", import.meta.url),
      "utf8",
    );
    expect(stitchEngine().renderApp("Stitch")).toBe(golden);
  });

  test("the stitch golden has one named pin command", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["stitch:pin"]).toBe("bun scripts/pin-stitch-spec.ts");
  });

  test("a reaction that stayed a pipeline is listed with its reason, never dropped", () => {
    const engine = stitchEngine();
    expect(engine.renderApp("Stitch")).not.toContain(
      "Reactions represented only by executable code",
    );

    const work = new WorkConcept({ nextId: 1, items: [] });
    const Work = engine.instrument(work);
    const WithTransform = ({ item }: Vars) =>
      when(Work.complete, {}, { item }).then(
        request(Work.pause, { id: item }).where((frames: Frames) =>
          frames.map((frame) => ({ ...frame })),
        ),
      );
    engine.register({ WithTransform });

    const spec = engine.renderApp("Stitch");
    expect(spec).toContain("Reactions represented only by executable code");
    expect(spec).toContain("`WithTransform` — a step transform in the pipeline");
  });
});
