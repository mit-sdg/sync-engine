import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Query lines, `no(...)`, `whether(...)`, named computations, and custom
 * operations evaluated against frames. These tests cover matching, binding,
 * absence, promise enforcement, and repeated bindings.
 */
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { is, no, reaction, whether, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { Frames } from "@sync-engine/internal/reads/frames";
import { applyWhereOps } from "@sync-engine/internal/reads/where-evaluation";
import { compute, custom } from "@sync-engine/internal/reads/where-ops";
import { structurallyEqual } from "@sync-engine/internal/reads/value-equality";
import { vocabularyComputations } from "@sync-engine/internal/reactions/authoring/refs";
import { $vars } from "@sync-engine/internal/reactions/authoring/vars";
import { quietReacting } from "../../utils/reacting.ts";
import type { InstrumentedQuery } from "@sync-engine/internal/reactions/types";
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

const refs = vocabulary({
  concepts: {
    List: ListConcept,
    Promised: PromisedConcept,
    Recorder: RecorderConcept,
    Shelf: ShelfConcept,
  },
}).concepts;

function setup() {
  const reacting = quietReacting();
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

  test("an unbound optional input preserves only another optional read", async () => {
    const calls: unknown[] = [];
    const source = ((_: { key: string }) => []) as unknown as InstrumentedQuery;
    source.concept = {};
    source.queryName = "_source";
    const next = ((input: { key: string }) => {
      calls.push(input);
      return [];
    }) as unknown as InstrumentedQuery;
    next.concept = {};
    next.queryName = "_next";
    const { key, value } = $vars;

    const optional = await applyWhereOps(new Frames({}), [
      whether(lineOf({ query: source }, { key }).is({ value })),
      whether(lineOf({ query: next }, { key })),
    ]);
    expect(optional).toHaveLength(1);
    expect(calls).toEqual([]);

    const plain = await applyWhereOps(new Frames({}), [
      whether(lineOf({ query: source }, { key }).is({ value })),
      lineOf({ query: next }, { key }),
    ]);
    expect(plain).toHaveLength(0);
    expect(calls).toEqual([]);
  });

  test("serialized optional bindings suppress dependent reads", async () => {
    let dependentCalls = 0;
    const source = Object.assign(() => [], { queryName: "_source" }) as InstrumentedQuery;
    const dependent = Object.assign(
      () => {
        dependentCalls++;
        return [{}];
      },
      { queryName: "_dependent" },
    ) as InstrumentedQuery;
    const env = {
      query: ({ query }: { query: string }) => (query === "_source" ? source : dependent),
    } as never;
    const optional = {
      op: "whether" as const,
      query: { concept: "Source", query: "_source" },
      in: {},
      out: { key: { $var: "key" } },
    };
    const dependentRead = (op: "find" | "whether") => ({
      op,
      query: { concept: "Dependent", query: "_dependent" },
      in: { key: { $var: "key" } },
      out: {},
    });

    expect(
      await applyWhereOps(new Frames({}), [optional, dependentRead("whether")], env),
    ).toHaveLength(1);
    expect(
      await applyWhereOps(new Frames({}), [optional, dependentRead("find")], env),
    ).toHaveLength(0);
    expect(dependentCalls).toBe(0);

    expect(
      await applyWhereOps(
        new Frames({}),
        [
          {
            op: "find",
            query: { concept: "Dependent", query: "_dependent" },
            in: { payload: { $lit: { $var: "literal" } } },
            out: {},
          },
        ],
        env,
      ),
    ).toHaveLength(1);
    expect(dependentCalls).toBe(1);
  });

  test("closed relations admit exactly the rows they hold for", async () => {
    const { n } = $vars;
    const frames = new Frames({ [n]: 1 }, { [n]: 2 }, { [n]: 3 });
    const values = async (ops: Parameters<typeof applyWhereOps>[1]) =>
      [...(await applyWhereOps(frames, ops))].map(($) => $[n]);
    expect(await values([is.gt(n, 2)])).toEqual([3]);
    expect(await values([is.ge(n, 2)])).toEqual([2, 3]);
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

  test("compute projects an object result into several bindings", async () => {
    const describe = vocabulary({
      concepts: {},
      computations: {
        describe: ({ n }: { n: number }) => ({
          doubled: n * 2,
          details: { parity: n % 2 },
        }),
      },
    }).computations.describe;
    const { n, doubled, parity } = $vars;
    const out = await applyWhereOps(new Frames({ [n]: 3 }), [
      compute(describe, { n }, { doubled, details: { parity } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0][doubled]).toBe(6);
    expect(out[0][parity]).toBe(1);
  });

  test("serialized compute projections bind beneath escaped dollar keys", async () => {
    const env = {
      computation: () => ({ fn: () => ({ data: { $field: 3 } }) }),
    } as never;
    const out = await applyWhereOps(
      new Frames({}),
      [
        {
          op: "compute",
          computation: "describe",
          in: {},
          out: { data: { $lit: { $field: { $var: "bound" } } } },
        },
      ],
      env,
    );
    expect(out).toEqual([{ bound: 3 }]);
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
    expect(() => compute(double, {}, "notavar" as never)).toThrow("one variable or a record");
  });
});

describe("where ops: inside a reaction", () => {
  test("an absent whether output reaches a consequence as null", async () => {
    const reacting = quietReacting();
    const { Promised, Recorder } = reacting.instrument({
      Promised: new PromisedConcept(),
      Recorder: new RecorderConcept(),
    });
    reacting.register({
      RecordsBlank: reaction(({ value }: Vars) =>
        when(refs.Promised.start({}).responds())
          .where(whether(refs.Promised._maybe({}).is({ value })))
          .then(refs.Recorder.record({ tag: value })),
      ),
    });

    await (Promised as unknown as { start: (input: object) => Promise<unknown> }).start({});
    expect(Recorder.order).toEqual([null]);
  });

  test("plain reads use each query's declared promise", async () => {
    const reacting = quietReacting();
    const { Promised, Recorder } = reacting.instrument({
      Promised: new PromisedConcept(),
      Recorder: new RecorderConcept(),
    });
    reacting.register({
      ReadsPlainly: reaction(({ value }: Vars) =>
        when(refs.Promised.start({}).responds())
          .where(refs.Promised._many({}).is({ value }))
          .then(refs.Recorder.record({ tag: value })),
      ),
    });
    await (Promised as unknown as { start: (input: object) => Promise<unknown> }).start({});
    expect((Recorder as unknown as { order: unknown[] }).order).toEqual([1]);
  });

  test("registration rejects unavailable inputs and new names inside no", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.register({
        Unbound: reaction(({ missing, id }: Vars) =>
          when(refs.List.add({}).responds())
            .where(refs.Shelf._byOwner({ owner: missing }).is({ id }))
            .then(refs.Recorder.record({ tag: id })),
        ),
      }),
    ).toThrow("the conditions cannot be ordered — find Shelf._byOwner needs");
    expect(() =>
      reacting.register({
        BornInDenial: reaction(({ owner, local }: Vars) =>
          when(refs.Shelf.add({ owner }).responds())
            .where(no(refs.Shelf._byOwner({ owner }).is({ id: local })))
            .then(refs.Recorder.record({ tag: owner })),
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
        when(refs.List.add({ value: trigger }).responds())
          .where(refs.List._items({}).is({ value }), is.gt(value, 2))
          .then(refs.Recorder.record({ tag: value })),
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
        when(refs.List.add({ value }).responds())
          .where(compute(stamp, {}, mark))
          .then(refs.Recorder.record({ tag: mark })),
      ),
    });

    await List.add({ value: 7 });
    expect(Recorder.order).toEqual(["stamped"]);
    const firings = reacting.Action.store.firingsByReaction("Stamped");
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

class RowsConcept {
  rows: unknown[] = [];
  _rows() {
    return this.rows;
  }
}

describe("where ops: distinct fills", () => {
  async function fills(rows: unknown[], frame: Frames = new Frames({})) {
    const { reacting } = setup();
    const raw = new RowsConcept();
    const { Rows } = reacting.instrument({ Rows: raw });
    raw.rows = rows;
    const { a, b } = $vars;
    const out = await applyWhereOps(frame, [lineOf({ query: Rows._rows }, {}).is({ a, b })]);
    return { out, a, b };
  }

  test("keeps the first of equal fills, in row order", async () => {
    const first = { tag: "x" };
    const { out, a } = await fills([
      { a: first, b: 1 },
      { a: 2, b: 1 },
      { a: { tag: "x" }, b: 1 },
      { a: 3, b: 1 },
    ]);
    expect(out.map((frame) => frame[a])).toEqual([first, 2, 3]);
    expect(out[0][a]).toBe(first);
  });

  test("tells apart primitives that equality tells apart", async () => {
    const values = [0, -0, Number.NaN, Number.NaN, "1", 1, true, undefined, null, {}, 0, null];
    const { out, a } = await fills(values.map((value) => ({ a: value, b: 0 })));
    const kept = out.map((frame) => frame[a]);
    const expected = [0, -0, Number.NaN, "1", 1, true, undefined, null, {}];
    expect(kept).toHaveLength(expected.length);
    expected.forEach((value, index) =>
      expect(
        typeof value === "object" && value !== null ? kept[index] : Object.is(kept[index], value),
      ).toBeTruthy(),
    );
  });

  test("keeps rows that differ where one has a hole, in either order", async () => {
    const rows = [
      // eslint-disable-next-line no-sparse-arrays -- holes are the case under test.
      { a: [, 1], b: 0 },
      { a: [5, 1], b: 0 },
    ];
    expect((await fills(rows)).out).toHaveLength(2);
    expect((await fills(rows.toReversed())).out).toHaveLength(2);
  });

  test("matches a hole in a line pattern only to undefined, so is and is.not agree", async () => {
    const { reacting } = setup();
    const raw = new RowsConcept();
    const { Rows } = reacting.instrument({ Rows: raw });
    // eslint-disable-next-line no-sparse-arrays -- holes are the case under test.
    const holey = [, 1];
    const passes = async (a: unknown[]) => {
      raw.rows = [{ a }];
      reacting.invalidateAllCaches();
      const line = lineOf({ query: Rows._rows }, {});
      return [
        (await applyWhereOps(new Frames({}), [line.is({ a: holey })])).length,
        (await applyWhereOps(new Frames({}), [line.is.not({ a: holey })])).length,
      ];
    };
    expect(await passes([5, 1])).toEqual([0, 1]);
    expect(await passes([undefined, 1])).toEqual([1, 0]);
  });

  test("never runs a value's toJSON while removing duplicates", async () => {
    const throwing = Object.defineProperty(() => 0, "toJSON", {
      get(): never {
        throw new Error("toJSON ran");
      },
    });
    let calls = 0;
    const counting = Object.assign(() => 0, { toJSON: () => ++calls });
    const { out } = await fills([
      { a: throwing, b: counting },
      { a: throwing, b: counting },
      { a: { inner: throwing }, b: [counting] },
      { a: { inner: throwing }, b: [counting] },
    ]);
    expect(out).toHaveLength(2);
    expect(calls).toBe(0);
  });

  test("never runs an app's Array.prototype.toJSON while removing duplicates", async () => {
    let calls = 0;
    Object.defineProperty(Array.prototype, "toJSON", {
      value: () => ++calls,
      configurable: true,
      writable: true,
    });
    try {
      const { out } = await fills([
        { a: "x", b: 1 },
        { a: "x", b: 1 },
        { a: "y", b: 1 },
      ]);
      expect(out).toHaveLength(2);
    } finally {
      delete (Array.prototype as { toJSON?: unknown }).toJSON;
    }
    expect(calls).toBe(0);
  });

  test("keeps the fills a pairwise comparison keeps, over generated rows", async () => {
    let seed = 7;
    const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const shared = { k: [1] };
    const opaque = new Map();
    const pool = (): unknown[] => [
      0,
      -0,
      Number.NaN,
      1,
      "1",
      "",
      true,
      false,
      undefined,
      null,
      1n,
      Symbol.for("s"),
      { k: [1] },
      { p: 1, q: 2 },
      { q: 2, p: 1 },
      shared,
      [1],
      [1, 2],
      new Date(0),
      new Date(0),
      opaque,
      () => 0,
      // eslint-disable-next-line no-sparse-arrays -- holes are the case under test.
      [, 1],
      [5, 1],
      [undefined, 1],
    ];
    const pick = () => {
      const values = pool();
      return values[Math.floor(next() * values.length)];
    };
    for (let round = 0; round < 2000; round += 1) {
      const rows = Array.from({ length: Math.floor(next() * 10) }, () => {
        const row: Record<string, unknown> = { a: pick() };
        if (next() < 0.9) row.b = next() < 0.7 ? Math.floor(next() * 2) : pick();
        return row;
      });
      const { out, a, b } = await fills(rows);
      const expected: Record<symbol, unknown>[] = [];
      for (const row of rows) {
        if (!Object.hasOwn(row, "b")) continue;
        const fill = { [a]: row.a, [b]: row.b };
        if (!expected.some((prior) => structurallyEqual(prior, fill))) expected.push(fill);
      }
      expect(out).toHaveLength(expected.length);
      out.forEach((frame, index) => expect(structurallyEqual(frame, expected[index])).toBe(true));
    }
  });
});
