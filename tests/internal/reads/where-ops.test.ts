import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Query lines, `no(...)`, `whether(...)`, named computations, and custom
 * operations evaluated against frames. These tests cover matching, binding,
 * absence, promise enforcement, and repeated bindings.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  $vars,
  applyWhereOps,
  compute,
  custom,
  Frames,
  is,
  no,
  Logging,
  reaction,
  whether,
  Reacting,
  type Vars,
  vocabulary,
  vocabularyComputations,
  when,
} from "@sync-engine/internal/reactions";
import { ListConcept, RecorderConcept } from "../reactions/mocks.ts";

class ShelfConcept {
  books: Array<{ id: string; owner: string; title: string }> = [];
  add({ id, owner, title }: { id: string; owner: string; title: string }) {
    this.books.push({ id, owner, title });
    return { id };
  }
  _byOwner({ owner }: { owner: string }) {
    return this.books.filter((book) => book.owner === owner);
  }
}

class PromisedConcept {
  static readonly queries = {
    _one: "one",
    _maybe: "optional",
    _many: "many",
  } as const;
  start() {
    return {};
  }
  _one() {
    return { value: 1 };
  }
  _maybe() {
    return [] as { value: number }[];
  }
  _many() {
    return [{ value: 1 }];
  }
}

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
    Shelf: new ShelfConcept(),
  });
  return { reacting, ...concepts };
}

class MisansweringConcept {
  static readonly queries = { _one: "one", _maybe: "optional" } as const;
  rows: { value: number }[] = [];
  _one() {
    return this.rows.length === 1 ? this.rows[0] : (this.rows as unknown);
  }
  _maybe() {
    return this.rows;
  }
}

describe("where ops: evaluation", () => {
  test("a violated query promise is an integrity fault that names the query", async () => {
    const { reacting } = setup();
    const raw = new MisansweringConcept();
    const { Mis } = reacting.instrument({ Mis: raw });
    const { value } = $vars;
    await expect(
      applyWhereOps(new Frames({}), [lineOf({ query: Mis._one }, {}).is({ value })]),
    ).rejects.toThrow('promises "one"');
    raw.rows = [{ value: 1 }, { value: 2 }];
    reacting.invalidateAllCaches();
    await expect(
      applyWhereOps(new Frames({}), [whether(lineOf({ query: Mis._maybe }, {}).is({ value }))]),
    ).rejects.toThrow('promises "optional"');
  });

  test("some and no are existential claims and bind nothing", async () => {
    const { Shelf } = setup();
    await Shelf.add({ id: "b1", owner: "priya", title: "A" });
    const { owner } = $vars;
    expect(
      await applyWhereOps(new Frames({ [owner]: "priya" }), [
        lineOf({ query: Shelf._byOwner }, { owner }).is({ title: "A" }),
      ]),
    ).toHaveLength(1);
    expect(
      await applyWhereOps(new Frames({ [owner]: "sam" }), [
        no(lineOf({ query: Shelf._byOwner }, { owner })),
      ]),
    ).toHaveLength(1);
  });

  test("a plain query line matches literals and returns each distinct binding once", async () => {
    const { Shelf } = setup();
    await Shelf.add({ id: "same", owner: "priya", title: "A" });
    await Shelf.add({ id: "same", owner: "priya", title: "A" });
    await Shelf.add({ id: "other", owner: "priya", title: "B" });
    const { owner, id } = $vars;
    const rows = await applyWhereOps(new Frames({ [owner]: "priya" }), [
      lineOf({ query: Shelf._byOwner }, { owner }).is({ id, title: "A" }),
    ]);
    expect(rows.map((frame) => frame[id])).toEqual(["same"]);
  });
  test("a plain query line returns one frame per match and none when no row matches", async () => {
    const { Shelf } = setup();
    await Shelf.add({ id: "b1", owner: "priya", title: "A" });
    await Shelf.add({ id: "b2", owner: "priya", title: "B" });
    const { owner, id } = $vars;

    const priya = await applyWhereOps(new Frames({ [owner]: "priya" }), [
      lineOf({ query: Shelf._byOwner }, { owner }).is({ id }),
    ]);
    expect([...priya].map(($) => String($[id])).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "b1",
      "b2",
    ]);

    const sam = await applyWhereOps(new Frames({ [owner]: "sam" }), [
      lineOf({ query: Shelf._byOwner }, { owner }).is({ id }),
    ]);
    expect(sam.length).toBe(0);
  });

  test("whether preserves the row on no match, binding nothing", async () => {
    const { Shelf } = setup();
    const { owner, id } = $vars;
    const out = await applyWhereOps(new Frames({ [owner]: "sam" }), [
      whether(lineOf({ query: Shelf._byOwner }, { owner }).is({ id })),
    ]);
    expect(out.length).toBe(1);
    expect(id in out[0]).toBe(false);
  });

  test("closed relations admit exactly the rows they hold for", async () => {
    const { n } = $vars;
    const frames = new Frames({ [n]: 1 }, { [n]: 2 }, { [n]: 3 });
    const values = async (ops: Parameters<typeof applyWhereOps>[1]) =>
      [...(await applyWhereOps(frames, ops))].map(($) => $[n]);
    expect(await values([is.gt(n, 2)])).toEqual([3]);
    expect(await values([is.among(n, [1, 3])])).toEqual([1, 3]);
  });

  test("a registered domain computation packages like the stdlib", async () => {
    const matches = vocabulary({
      concepts: {},
      computations: { matches: ({ key, attempt }) => key === attempt },
    }).computations.matches;
    const { key, attempt } = $vars;
    const frames = new Frames(
      { [key]: "s3cret", [attempt]: "s3cret" },
      { [key]: "s3cret", [attempt]: "nope" },
    );
    const out = await applyWhereOps(frames, [matches({ key, attempt })]);
    expect(out.length).toBe(1);
  });

  test("compute evaluates per row and binds its output last", async () => {
    const double = vocabulary({
      concepts: {},
      computations: { double: ({ n }) => (n as number) * 2 },
    }).computations.double;
    const { n, twice } = $vars;
    const out = await applyWhereOps(new Frames({ [n]: 2 }, { [n]: 5 }), [
      compute(double, { n }, twice),
    ]);
    expect(out.map(($) => $[twice])).toEqual([4, 10]);
  });

  test("custom declares its footprint positionally and stays quarantined", async () => {
    const { a, b, sum } = $vars;
    const out = await applyWhereOps(new Frames({ [a]: 2, [b]: 3 }), [
      custom((x, y) => (x as number) + (y as number), [a, b], [sum]),
    ]);
    expect(out[0][sum]).toBe(5);
  });

  test("a throwing computation raises a runtime fault", async () => {
    const boom = vocabulary({
      concepts: {},
      computations: {
        boom: () => {
          throw new Error("boom");
        },
      },
    }).computations.boom;
    const { n } = $vars;
    await expect(applyWhereOps(new Frames({ [n]: 1 }), [boom({})])).rejects.toThrow("boom");
  });
});

describe("where ops: construction guards", () => {
  test("compute requires a vocabulary computation and a single out variable", () => {
    const double = vocabulary({
      concepts: {},
      computations: { double: ({ n }) => (n as number) * 2 },
    }).computations.double;
    expect(() => compute((() => 1) as never, {}, Symbol("x"))).toThrow("vocabulary");
    expect(() => compute(double, {}, "notavar" as never)).toThrow("single variable");
  });
});

describe("where ops: inside a reaction", () => {
  test("plain reads use each query's declared promise", async () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Promised, Recorder } = reacting.instrument({
      Promised: new PromisedConcept(),
      Recorder: new RecorderConcept(),
    });
    reacting.register({
      ReadsPlainly: reaction(({ value }: Vars) =>
        when(Promised.start, {})
          .where(lineOf({ query: Promised._many }, {}).is({ value }))
          .then(request(Recorder.record, { tag: value })),
      ),
    });
    await (Promised as unknown as { start: (input: object) => Promise<unknown> }).start({});
    expect((Recorder as unknown as { order: unknown[] }).order).toEqual([1]);
  });

  test("registration rejects unavailable inputs and new names inside no", () => {
    const { reacting, List, Shelf, Recorder } = setup();
    expect(() =>
      reacting.register({
        Unbound: reaction(({ missing, id }: Vars) =>
          when(List.add, {})
            .where(lineOf({ query: Shelf._byOwner }, { owner: missing }).is({ id }))
            .then(request(Recorder.record, { tag: id })),
        ),
      }),
    ).toThrow("no line opens");
    expect(() =>
      reacting.register({
        BornInDenial: reaction(({ owner, local }: Vars) =>
          when(Shelf.add, { owner })
            .where(no(lineOf({ query: Shelf._byOwner }, { owner }).is({ id: local })))
            .then(request(Recorder.record, { tag: owner })),
        ),
      }),
    ).toThrow("no(...) can only test names bound by an earlier plain line");
  });
  test("a reaction's where reads as ops and fires once per surviving row", async () => {
    const { reacting, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });

    reacting.register({
      RecordBig: reaction(({ trigger, value }: Vars) =>
        when(List.add, { value: trigger }, {})
          .where(lineOf({ query: List._items }, {}).is({ value }), is.gt(value, 2))
          .then(request(Recorder.record, { tag: value })),
      ),
    });

    await List.add({ value: 4 });
    expect(Recorder.order).toEqual([4]);
  });

  test("compute adds a per-firing value to the firing record's bindings", async () => {
    const { reacting, List, Recorder } = setup();
    const words = vocabulary({ concepts: {}, computations: { stamp: () => "stamped" } });
    const stamp = words.computations.stamp;
    reacting.registerComputations(vocabularyComputations(words));
    reacting.register({
      Stamped: reaction(({ value, mark }: Vars) =>
        when(List.add, { value }, {})
          .where(compute(stamp, {}, mark))
          .then(request(Recorder.record, { tag: mark })),
      ),
    });

    await List.add({ value: 7 });
    expect(Recorder.order).toEqual(["stamped"]);
    const firings = reacting._getFirings("Stamped");
    expect(firings.length).toBe(1);
    expect(firings[0].bindings.mark).toBe("stamped");
  });
});

describe("where ops: out-bindings unify", () => {
  test("a plain query line tests an already-bound output instead of rebinding it", async () => {
    const { Shelf } = setup();
    await Shelf.add({ id: "b1", owner: "priya", title: "A" });
    await Shelf.add({ id: "b2", owner: "priya", title: "B" });
    const { owner, id } = $vars;

    const matching = await applyWhereOps(new Frames({ [owner]: "priya", [id]: "b2" }), [
      lineOf({ query: Shelf._byOwner }, { owner }).is({ id }),
    ]);
    expect(matching.length).toBe(1);
    expect(matching[0][id]).toBe("b2");

    const conflicting = await applyWhereOps(new Frames({ [owner]: "priya", [id]: "zzz" }), [
      lineOf({ query: Shelf._byOwner }, { owner }).is({ id }),
    ]);
    expect(conflicting.length).toBe(0);
  });

  test("whether(...) treats an output conflict as no match and preserves the existing binding", async () => {
    const { Shelf } = setup();
    await Shelf.add({ id: "b1", owner: "priya", title: "A" });
    const { owner, id } = $vars;
    const out = await applyWhereOps(new Frames({ [owner]: "priya", [id]: "zzz" }), [
      whether(lineOf({ query: Shelf._byOwner }, { owner }).is({ id })),
    ]);
    expect(out.length).toBe(1);
    expect(out[0][id]).toBe("zzz");
  });

  test("compute with an already-bound out tests the computed value", async () => {
    const twice = vocabulary({
      concepts: {},
      computations: { twice: ({ n }) => (n as number) * 2 },
    }).computations.twice;
    const { n, expected } = $vars;
    const agree = await applyWhereOps(new Frames({ [n]: 2, [expected]: 4 }), [
      compute(twice, { n }, expected),
    ]);
    expect(agree.length).toBe(1);
    const disagree = await applyWhereOps(new Frames({ [n]: 2, [expected]: 5 }), [
      compute(twice, { n }, expected),
    ]);
    expect(disagree.length).toBe(0);
  });

  test("custom with an already-bound out unifies its declared footprint", async () => {
    const { a, sum } = $vars;
    const inc = (x: unknown) => (x as number) + 1;
    const agree = await applyWhereOps(new Frames({ [a]: 1, [sum]: 2 }), [custom(inc, [a], [sum])]);
    expect(agree.length).toBe(1);
    const disagree = await applyWhereOps(new Frames({ [a]: 1, [sum]: 9 }), [
      custom(inc, [a], [sum]),
    ]);
    expect(disagree.length).toBe(0);
  });
});
