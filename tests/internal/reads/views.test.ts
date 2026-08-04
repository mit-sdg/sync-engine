/**
 * Views: named answers to standing questions — the third ref kind.
 *
 * A view packages into `keep(...)` exactly like a computation, is defined
 * once beside the reactions, and is the one home for disjunction (stacked
 * where blocks) and aggregation (`count`). These tests use the public
 * own examples: `(requester) may read (file)`, `(venue) has room`.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  count,
  earlier,
  is,
  reaction,
  view,
  vocabulary,
  when,
  where,
  whether,
} from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { Frames } from "@sync-engine/internal/reads/frames";
import { analyzeLocalBehavior } from "@sync-engine/internal/reads/local-behavior";
import type { AppIR } from "@sync-engine/internal/reads/ir";
import { renderApp, renderReaction } from "@sync-engine/internal/reads/render";
import { applyWhereOps } from "@sync-engine/internal/reads/where-evaluation";
import { custom } from "@sync-engine/internal/reads/where-ops";
import type { WhereOp } from "@sync-engine/internal/reads/where-ops";
import type { ViewOp } from "@sync-engine/internal/reads/views";
import { $vars } from "@sync-engine/internal/reactions/authoring/vars";
import { quietReacting } from "../../utils/reacting.ts";
import { RecorderConcept } from "../reactions/mocks.ts";

// ── Test concepts ──────────────────────────────────────────────────────────

interface FileRow {
  id: string;
  owner: string;
  sharedWith: string[];
}

class FilingConcept {
  files: FileRow[] = [];
  sharedWithInputs: unknown[] = [];
  add({ id, owner }: { id: string; owner: string }) {
    this.files.push({ id, owner, sharedWith: [] });
    return { id };
  }
  share({ id, person }: { id: string; person: string }) {
    this.files.find((file) => file.id === id)?.sharedWith.push(person);
    return { id, person };
  }
  open({ id, requester }: { id: string; requester: string }) {
    return { id, requester };
  }
  _get({ id }: { id: string }): FileRow[] {
    return this.files.filter((file) => file.id === id);
  }
  _sharedWith({ id }: { id: string }): { person: string }[] {
    this.sharedWithInputs.push(id);
    return (
      this.files.find((file) => file.id === id)?.sharedWith.map((person) => ({ person })) ?? []
    );
  }
}

class SeatingConcept {
  capacity = 2;
  seated: string[] = [];
  reserve({ person }: { person: string }) {
    return { person };
  }
  seat({ person }: { person: string }) {
    this.seated.push(person);
    return { person };
  }
  _seated(): { person: string }[] {
    return this.seated.map((person) => ({ person }));
  }
  _capacity(): { venue: string; capacity: number }[] {
    return [{ venue: "main", capacity: this.capacity }];
  }
}

const refs = vocabulary({
  concepts: { Filing: FilingConcept, Seating: SeatingConcept, Recorder: RecorderConcept },
}).concepts;

function setup() {
  const reacting = quietReacting();
  const concepts = reacting.instrument({
    Filing: new FilingConcept(),
    Seating: new SeatingConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

/**
 * Policy example: owner, or shared with. Out-bindings unify, so
 * `{ owner: requester }` reads as the condition
 * "the owner of file is requester" — an equality test, not a rebinding.
 */
function mayReadView() {
  return view("(requester) may read (file)", ({ requester, file }, _outputs, _bindings) => [
    where(refs.Filing._get({ id: file }).is({ owner: requester })),
    where(refs.Filing._sharedWith({ id: file }).is({ person: requester })),
  ]).holds();
}

/** Aggregate example: seats filled compared with capacity. */
function hasRoomView() {
  return view("(venue) has room", ({ venue }, _outputs, { filled, capacity }) =>
    where(
      count(refs.Seating._seated, {}, filled),
      refs.Seating._capacity({}).is({ venue, capacity }),
      is.lt(filled, capacity),
    ),
  ).holds();
}

// ── Definition ─────────────────────────────────────────────────────────────

describe("views: definition", () => {
  test("proxy bags mint stable bindings on destructuring and property access", () => {
    let sameInput = false;
    let sameOutput = false;
    const ownerOf = view("the selected owner of (file)", (inputs, outputs, _bindings) => {
      const { file } = inputs;
      const { owner } = outputs;
      sameInput = file === inputs.file;
      sameOutput = owner === outputs.owner;
      return where(refs.Filing._get({ id: file }).is({ owner }));
    }).optional();

    expect(sameInput).toBe(true);
    expect(sameOutput).toBe(true);
    expect(ownerOf.ins).toEqual(["file"]);
    expect(ownerOf.outs).toEqual(["owner"]);
  });

  test("the input bag declares the call parameters", () => {
    const mayRead = mayReadView();
    expect(mayRead.viewName).toBe("(requester) may read (file)");
    expect(mayRead.ins).toEqual(["requester", "file"]);
    expect(() => mayRead({ requester: "priya" })).toThrowError(
      new Error('View "(requester) may read (file)": required input "file" is missing.'),
    );
    expect(() => mayRead({ requester: "priya", file: "f1", extra: true })).toThrowError(
      new Error(
        'View "(requester) may read (file)": "extra" is not an input; expected (requester, file).',
      ),
    );
    expect(() => mayRead("priya" as never)).toThrowError(
      new Error('View "(requester) may read (file)" takes one object-shaped input mapping.'),
    );
    expect(mayRead.name).toBe("ref");
    expect(mayRead.holds.name).toBe("value");
    expect(Object.keys(mayRead)).toEqual(["viewName", "ins", "outs", "bindings", "holdsPredicate"]);
    expect(Object.getOwnPropertyDescriptor(mayRead, "alternatives")?.enumerable).toBe(false);
  });

  test("an input binding the body never uses is a definition error", () => {
    expect(() =>
      view("a ghost haunts", ({ ghost: _ghost }, _outputs, _bindings) =>
        where(is.lt(1, 2)),
      ).holds(),
    ).toThrow('input binding "ghost" is declared but never used');
  });

  test("a view answers from standing state — earlier() is rejected", () => {
    expect(() =>
      view("(file) was opened", ({ file }, _outputs, _bindings) =>
        // the runtime guard's job — the type system already refuses this
        where(earlier(refs.Filing.open, { id: file }) as unknown as ViewOp),
      ).holds(),
    ).toThrow("standing state");
  });

  test("name text is semantically inert", () => {
    const named = view("(two words) with one (answer), if any", (_inputs, _outputs, _bindings) =>
      where(is.lt(1, 2)),
    ).holds();
    expect(named.viewName).toBe("(two words) with one (answer), if any");
    expect(named.ins).toEqual([]);
    expect(named.outs).toEqual([]);
    expect(named.holdsPredicate).toBe(true);
  });

  test("an output view defaults to many", () => {
    const sharedWith = view("the people sharing a file", ({ file }, { person }, _bindings) =>
      where(refs.Filing._sharedWith({ id: file }).is({ person })),
    );
    expect(sharedWith.ins).toEqual(["file"]);
    expect(sharedWith.outs).toEqual(["person"]);
    expect(sharedWith.promise).toBe("many");
  });

  test("a binding from outside the declaration is rejected", () => {
    const { owner } = $vars;
    expect(() =>
      view("a file has an owner", ({ file }, _outputs, _bindings) =>
        where(refs.Filing._get({ id: file }).is({ owner })),
      ).holds(),
    ).toThrow('binding "owner" is not declared in the input, output, or free binding bag');
  });

  test("a predicate terminal rejects declared outputs", () => {
    expect(() =>
      view("an owner of a file", ({ file }, { owner }, _bindings) =>
        where(refs.Filing._get({ id: file }).is({ owner })),
      ).holds(),
    ).toThrow("holds() requires an empty output binding bag");
  });

  test("count outside a view is rejected where reactions are declared", () => {
    const { file, n } = $vars;
    expect(() =>
      when(refs.Filing.add({ id: file }).responds())
        .where(count(refs.Filing._sharedWith, { id: file }, n) as unknown as WhereOp)
        .then(refs.Recorder.record({ tag: file })),
    ).toThrow("count(...) cannot be used in a reaction condition");
  });
});

// ── Evaluation ─────────────────────────────────────────────────────────────

describe("views: evaluation", () => {
  test("stacked where blocks are alternatives — the disjunction lives here", async () => {
    const { reacting, Filing } = setup();
    await Filing.add({ id: "f1", owner: "priya" });
    await Filing.share({ id: "f1", person: "sam" });
    const mayRead = mayReadView();
    const { requester, file } = $vars;

    const admitted = async (who: string) =>
      (
        await applyWhereOps(
          new Frames({ [requester]: who, [file]: "f1" }),
          [mayRead({ requester, file })],
          reacting.readEnv(),
        )
      ).length;

    expect(await admitted("priya")).toBe(1); // the owner
    expect(await admitted("sam")).toBe(1); // shared with
    expect(await admitted("mallory")).toBe(0); // neither
  });

  test("count aggregates at the moment of asking", async () => {
    const { reacting, Seating } = setup();
    const hasRoom = hasRoomView();
    const { venue } = $vars;

    const roomy = async () =>
      (
        await applyWhereOps(
          new Frames({ [venue]: "main" }),
          [hasRoom({ venue })],
          reacting.readEnv(),
        )
      ).length;

    expect(await roomy()).toBe(1); // 0 of 2
    await Seating.seat({ person: "a" });
    expect(await roomy()).toBe(1); // 1 of 2
    await Seating.seat({ person: "b" });
    expect(await roomy()).toBe(0); // full
  });

  test("count with an already-bound slot is an equality test", async () => {
    const { reacting, Seating } = setup();
    const seatsExactly = view("(venue) seats exactly (n)", ({ venue, n }, _outputs, _bindings) =>
      where(refs.Seating._capacity({}).is({ venue }), count(refs.Seating._seated, {}, n)),
    ).holds();
    const { v } = $vars;
    const holds = async (n: number) =>
      (
        await applyWhereOps(
          new Frames({ [v]: "main" }),
          [seatsExactly({ venue: v, n })],
          reacting.readEnv(),
        )
      ).length;
    expect(await holds(0)).toBe(1);
    await Seating.seat({ person: "a" });
    expect(await holds(0)).toBe(0);
    expect(await holds(1)).toBe(1);
  });

  test("a reaction guarded by a view fires exactly when the view holds", async () => {
    const { reacting, Filing, Recorder } = setup();
    const mayRead = mayReadView();
    reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(refs.Filing.open({ id: file, requester }).responds())
          .where(mayRead({ requester, file }))
          .then(refs.Recorder.record({ tag: requester })),
      ),
    });
    await Filing.add({ id: "f1", owner: "priya" });
    await Filing.share({ id: "f1", person: "sam" });
    await Filing.open({ id: "f1", requester: "priya" });
    await Filing.open({ id: "f1", requester: "mallory" });
    await Filing.open({ id: "f1", requester: "sam" });
    expect(Recorder.order).toEqual(["priya", "sam"]);
  });

  test("a view may rest on another view, and locals stay inside", async () => {
    const { reacting, Seating } = setup();
    const hasRoom = hasRoomView();
    const admits = view("(venue) admits", ({ venue }, _outputs, _bindings) =>
      where(hasRoom({ venue })),
    ).holds();
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(refs.Seating.reserve({ person }).responds())
          .where(admits({ venue: "main" }))
          .then(refs.Seating.seat({ person })),
      ),
    });
    await Seating.reserve({ person: "a" });
    await Seating.reserve({ person: "b" });
    await Seating.reserve({ person: "c" }); // full now — no seat
    expect(Seating.seated).toEqual(["a", "b"]);
  });

  test("a blank optional view output stays unbound for a later plain query", async () => {
    const { reacting, Filing } = setup();
    const optionalOwner = view("the optional owner of (file)", ({ file }, { owner }, _bindings) =>
      where(whether(refs.Filing._get({ id: file }).is({ owner }))),
    );
    const { file, owner } = $vars;
    const ops = [
      whether(optionalOwner({ file }).is({ owner })),
      refs.Filing._sharedWith({ id: owner }),
    ];

    expect(
      await applyWhereOps(new Frames({ [file]: "missing" }), ops, reacting.readEnv()),
    ).toHaveLength(0);
    expect(Filing.sharedWithInputs).toEqual([]);

    await Filing.add({ id: "null-owner", owner: null as never });
    expect(
      await applyWhereOps(new Frames({ [file]: "null-owner" }), ops, reacting.readEnv()),
    ).toHaveLength(0);
    expect(Filing.sharedWithInputs).toEqual([null]);
  });

  test("two different definitions of one sentence are rejected", () => {
    const { reacting } = setup();
    const one = view("(file) is precious", ({ file }, _outputs, _bindings) =>
      where(refs.Filing._get({ id: file })),
    ).holds();
    const two = view("(file) is precious", ({ file }, _outputs, _bindings) =>
      where(refs.Filing._sharedWith({ id: file })),
    ).holds();
    const declare = (name: string, ref: typeof one) =>
      reacting.register({
        [name]: reaction(({ file }: Vars) =>
          when(refs.Filing.add({ id: file }).responds())
            .where(ref({ file }))
            .then(refs.Recorder.record({ tag: file })),
        ),
      });
    declare("First", one);
    expect(() => declare("Second", two)).toThrow("different definition");
  });
});

// ── Export, round trip, rendering ──────────────────────────────────────────

describe("views: IR and round trip", () => {
  test("exportReactions carries referenced views, dependencies first", () => {
    const { reacting } = setup();
    const hasRoom = hasRoomView();
    const admits = view("(venue) admits", ({ venue }, _outputs, _bindings) =>
      where(hasRoom({ venue })),
    ).holds();
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(refs.Seating.reserve({ person }).responds())
          .where(admits({ venue: "main" }))
          .then(refs.Recorder.record({ tag: person })),
      ),
    });

    const app = reacting.exportReactions();
    expect(app.views.map((v) => v.name)).toEqual(["(venue) has room", "(venue) admits"]);
    const [hasRoomIR] = app.views;
    expect(hasRoomIR.alternatives.length).toBe(1);
    expect(hasRoomIR.alternatives[0].map((op) => op.op)).toEqual(["count", "find", "holds"]);
    // The reaction's keep carries the view with its input mapping filled.
    const [reactionIR] = app.reactions;
    expect(reactionIR.where).toEqual([
      {
        op: "find",
        view: "(venue) admits",
        in: { venue: "main" },
        out: {},
      },
    ]);
    expect(analyzeLocalBehavior(app).occurrences).toHaveLength(0);
  });

  test("export → JSON → registerViews + registerReactions behaves identically", async () => {
    const first = setup();
    const mayRead = mayReadView();
    first.reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(refs.Filing.open({ id: file, requester }).responds())
          .where(mayRead({ requester, file }))
          .then(refs.Recorder.record({ tag: requester })),
      ),
    });
    const exported: AppIR = JSON.parse(JSON.stringify(first.reacting.exportReactions()));

    const second = setup();
    second.reacting.registerViews(exported.views);
    second.reacting.registerReactions(exported.reactions);

    for (const engine of [first, second]) {
      await engine.Filing.add({ id: "f1", owner: "priya" });
      await engine.Filing.share({ id: "f1", person: "sam" });
      await engine.Filing.open({ id: "f1", requester: "priya" });
      await engine.Filing.open({ id: "f1", requester: "mallory" });
      await engine.Filing.open({ id: "f1", requester: "sam" });
    }
    expect(second.Recorder.order).toEqual(first.Recorder.order);
    expect(second.Recorder.order).toEqual(["priya", "sam"]);

    // The IR is a fixed point through the view round trip too.
    const reExported = JSON.parse(JSON.stringify(second.reacting.exportReactions()));
    expect(reExported.views).toEqual(exported.views);
    expect(reExported.reactions).toEqual(exported.reactions);
  });

  test("a view referenced only by a branch condition survives export and re-registration", () => {
    const first = setup();
    const mayRead = mayReadView();
    first.reacting.register({
      BranchRead: reaction(({ file, requester }: Vars) =>
        when(refs.Filing.open({ id: file, requester }).responds()).then(
          where(mayRead({ requester, file })).then(refs.Recorder.record({ tag: requester })),
        ),
      ),
    });

    const exported: AppIR = JSON.parse(JSON.stringify(first.reacting.exportReactions()));
    expect(exported.views.map(({ name }) => name)).toEqual(["(requester) may read (file)"]);

    const second = setup();
    second.reacting.registerViews(exported.views);
    second.reacting.registerReactions(exported.reactions);
    second.reacting.registerReactions(exported.reactions);
    expect(JSON.parse(JSON.stringify(second.reacting.exportReactions()))).toEqual(exported);
  });

  test("a reaction asking an unregistered view is rejected", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.registerReactions([
        {
          name: "Ghost",
          when: [
            {
              kind: "action",
              concept: "Filing",
              action: "open",
              input: { id: { $var: "f" } },
              output: {},
            },
          ],
          where: [{ op: "find", view: "(f) is haunted", in: { f: { $var: "f" } }, out: {} }],
          then: [
            {
              kind: "request",
              concept: "Recorder",
              action: "record",
              input: { tag: { $var: "f" } },
            },
          ],
        },
      ]),
    ).toThrow('view "(f) is haunted" is not registered');
  });

  test("a custom op inside a view stays visible in the opaque count", () => {
    const { reacting } = setup();
    const shady = view("(file) passes a custom check", ({ file }, _outputs, _bindings) =>
      where(custom((id) => typeof id === "string", [file], [])),
    ).holds();
    reacting.register({
      Checked: reaction(({ id }: Vars) =>
        when(refs.Filing.add({ id }).responds())
          .where(shady({ file: id }))
          .then(refs.Recorder.record({ tag: id })),
      ),
    });
    expect(analyzeLocalBehavior(reacting.exportReactions()).occurrences).toHaveLength(1);
  });
});

describe("views: rendering", () => {
  test("a view renders alternatives as stacked where blocks", () => {
    const { reacting } = setup();
    const mayRead = mayReadView();
    reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(refs.Filing.open({ id: file, requester }).responds())
          .where(mayRead({ requester, file }))
          .then(refs.Recorder.record({ tag: requester })),
      ),
    });
    const app = reacting.exportReactions();
    expect(renderApp({ title: "Reads", concepts: [], app })).toContain(
      [
        "```view",
        "(requester) may read (file) — inputs (requester, file); outputs (); bindings ()",
        "  where Filing._get (id: file) has (owner: requester)",
        "  where Filing._sharedWith (id: file) has (person: requester)",
        "```",
      ].join("\n"),
    );
    expect(renderReaction(app.reactions[0])).toContain(
      '  view "(requester) may read (file)" with (requester, file)',
    );
  });

  test("count renders as the count sentence; renderApp carries a Views section", () => {
    const { reacting } = setup();
    const hasRoom = hasRoomView();
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(refs.Seating.reserve({ person }).responds())
          .where(hasRoom({ venue: "main" }))
          .then(refs.Recorder.record({ tag: person })),
      ),
    });
    const app = reacting.exportReactions();
    const spec = renderApp({ title: "Seats", concepts: [], app });
    expect(spec).toContain("filled is the count of Seating._seated ()");
    expect(spec).toContain("## Views");
    expect(spec).toContain("```view\n(venue) has room");
  });
});
