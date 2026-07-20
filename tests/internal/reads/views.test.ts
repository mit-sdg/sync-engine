import { lineOf } from "@sync-engine/internal/reads/lines";
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
  request,
  type AppIR,
  applyWhereOps,
  custom,
  count,
  $vars,
  earlier,
  Frames,
  is,
  Logging,
  opaqueCount,
  reaction,
  renderApp,
  renderReaction,
  renderView,
  Reacting,
  type Vars,
  view,
  where,
  type ViewOp,
  type WhereOp,
  when,
} from "@sync-engine/internal/reactions";
import { RecorderConcept } from "../reactions/mocks.ts";

// ── Test concepts ──────────────────────────────────────────────────────────

interface FileRow {
  id: string;
  owner: string;
  sharedWith: string[];
}

class FilingConcept {
  files: FileRow[] = [];
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

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
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
function mayReadView(Filing: FilingConcept) {
  return view("(requester) may read (file)", ({ requester, file }) => [
    where(lineOf({ query: Filing._get }, { id: file }).is({ owner: requester })),
    where(lineOf({ query: Filing._sharedWith }, { id: file }).is({ person: requester })),
  ]);
}

/** Aggregate example: seats filled compared with capacity. */
function hasRoomView(Seating: SeatingConcept) {
  return view("(venue) has room", ({ venue, filled, capacity }) =>
    where(
      count(Seating._seated, {}, filled),
      lineOf({ query: Seating._capacity }, {}).is({ venue, capacity }),
      is.lt(filled, capacity),
    ),
  );
}

// ── Definition ─────────────────────────────────────────────────────────────

describe("views: definition", () => {
  test("the sentence's (slot) groups are the parameters, in order", () => {
    const { Filing } = setup();
    const mayRead = mayReadView(Filing);
    expect(mayRead.viewName).toBe("(requester) may read (file)");
    expect(mayRead.ins).toEqual(["requester", "file"]);
    expect(() => mayRead({ requester: "priya" })).toThrow('required input "file" is missing');
  });

  test("a slot the body never uses is a definition error", () => {
    expect(() => view("(ghost) haunts", () => where(is.lt(1, 2)))).toThrow("never used");
  });

  test("a view answers from standing state — earlier() is rejected", () => {
    const { Filing } = setup();
    expect(() =>
      view("(file) was opened", ({ file }) =>
        // the runtime guard's job — the type system already refuses this
        where(earlier(Filing.open, { id: file }) as unknown as ViewOp),
      ),
    ).toThrow("standing state");
  });

  test("a malformed slot group is a definition error", () => {
    expect(() => view("(two words) collide", () => where(is.lt(1, 2)))).toThrow(
      "not a single name",
    );
  });

  test("count outside a view is rejected where reactions are declared", () => {
    const { Filing, Recorder } = setup();
    const { file, n } = $vars;
    expect(() =>
      when(Filing.add, { id: file })
        .where(count(Filing._sharedWith, { id: file }, n) as unknown as WhereOp)
        .then(request(Recorder.record, { tag: file })),
    ).toThrow("count(...) cannot be used in a reaction condition");
  });
});

// ── Evaluation ─────────────────────────────────────────────────────────────

describe("views: evaluation", () => {
  test("stacked where blocks are alternatives — the disjunction lives here", async () => {
    const { reacting, Filing } = setup();
    await Filing.add({ id: "f1", owner: "priya" });
    await Filing.share({ id: "f1", person: "sam" });
    const mayRead = mayReadView(Filing);
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
    const hasRoom = hasRoomView(Seating);
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
    const seatsExactly = view("(venue) seats exactly (n)", ({ venue, n }) =>
      where(lineOf({ query: Seating._capacity }, {}).is({ venue }), count(Seating._seated, {}, n)),
    );
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
    const mayRead = mayReadView(Filing);
    reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(Filing.open, { id: file, requester })
          .where(mayRead({ requester, file }))
          .then(request(Recorder.record, { tag: requester })),
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
    const hasRoom = hasRoomView(Seating);
    const admits = view("(venue) admits", ({ venue }) => where(hasRoom({ venue })));
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(Seating.reserve, { person })
          .where(admits({ venue: "main" }))
          .then(request(Seating.seat, { person })),
      ),
    });
    await Seating.reserve({ person: "a" });
    await Seating.reserve({ person: "b" });
    await Seating.reserve({ person: "c" }); // full now — no seat
    expect(Seating.seated).toEqual(["a", "b"]);
  });

  test("two different definitions of one sentence are rejected", () => {
    const { reacting, Filing, Recorder } = setup();
    const one = view("(file) is precious", ({ file }) =>
      where(lineOf({ query: Filing._get }, { id: file })),
    );
    const two = view("(file) is precious", ({ file }) =>
      where(lineOf({ query: Filing._sharedWith }, { id: file })),
    );
    const declare = (name: string, ref: typeof one) =>
      reacting.register({
        [name]: reaction(({ file }: Vars) =>
          when(Filing.add, { id: file })
            .where(ref({ file }))
            .then(request(Recorder.record, { tag: file })),
        ),
      });
    declare("First", one);
    expect(() => declare("Second", two)).toThrow("different definition");
  });
});

// ── Export, round trip, rendering ──────────────────────────────────────────

describe("views: IR and round trip", () => {
  test("exportReactions carries referenced views, dependencies first", () => {
    const { reacting, Seating, Recorder } = setup();
    const hasRoom = hasRoomView(Seating);
    const admits = view("(venue) admits", ({ venue }) => where(hasRoom({ venue })));
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(Seating.reserve, { person })
          .where(admits({ venue: "main" }))
          .then(request(Recorder.record, { tag: person })),
      ),
    });

    const app = reacting.exportReactions();
    expect(app.views.map((v) => v.name)).toEqual(["(venue) has room", "(venue) admits"]);
    const [hasRoomIR] = app.views;
    expect(hasRoomIR.alternatives.length).toBe(1);
    expect(hasRoomIR.alternatives[0].map((op) => op.op)).toEqual(["count", "find", "holds"]);
    // The reaction's keep carries the view by sentence, slots filled.
    const [reactionIR] = app.reactions;
    expect(reactionIR.where).toEqual([
      {
        op: "find",
        view: "(venue) admits",
        in: { venue: "main" },
        out: {},
      },
    ]);
    expect(opaqueCount(app)).toBe(0);
  });

  test("export → JSON → registerViews + registerReactions behaves identically", async () => {
    const first = setup();
    const mayRead = mayReadView(first.Filing);
    first.reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(first.Filing.open, { id: file, requester })
          .where(mayRead({ requester, file }))
          .then(request(first.Recorder.record, { tag: requester })),
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
    const { reacting, Filing, Recorder } = setup();
    const shady = view("(file) passes a custom check", ({ file }) =>
      where(custom((id) => typeof id === "string", [file], [])),
    );
    reacting.register({
      Checked: reaction(({ id }: Vars) =>
        when(Filing.add, { id })
          .where(shady({ file: id }))
          .then(request(Recorder.record, { tag: id })),
      ),
    });
    expect(opaqueCount(reacting.exportReactions())).toBe(1);
  });
});

describe("views: rendering", () => {
  test("a view renders alternatives as stacked where blocks", () => {
    const { reacting, Filing, Recorder } = setup();
    const mayRead = mayReadView(Filing);
    reacting.register({
      ServeRead: reaction(({ file, requester }: Vars) =>
        when(Filing.open, { id: file, requester })
          .where(mayRead({ requester, file }))
          .then(request(Recorder.record, { tag: requester })),
      ),
    });
    const app = reacting.exportReactions();
    expect(renderView(app.views[0])).toBe(
      [
        "(requester) may read (file)",
        "  where Filing._get (id: file) has (owner: requester)",
        "  where Filing._sharedWith (id: file) has (person: requester)",
      ].join("\n"),
    );
    // The reaction's condition reads as the sentence, slots filled.
    expect(renderReaction(app.reactions[0])).toContain("  requester may read file");
  });

  test("count renders as the count sentence; renderApp carries a Views section", () => {
    const { reacting, Seating, Recorder } = setup();
    const hasRoom = hasRoomView(Seating);
    reacting.register({
      SeatOnReserve: reaction(({ person }: Vars) =>
        when(Seating.reserve, { person })
          .where(hasRoom({ venue: "main" }))
          .then(request(Recorder.record, { tag: person })),
      ),
    });
    const app = reacting.exportReactions();
    expect(renderView(app.views[0])).toContain("filled is the count of Seating._seated ()");
    const spec = renderApp({ title: "Seats", concepts: [], app });
    expect(spec).toContain("## Views");
    expect(spec).toContain("```view\n(venue) has room");
  });
});
