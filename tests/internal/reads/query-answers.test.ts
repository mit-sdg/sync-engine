import { lineOf } from "@sync-engine/internal/reads/lines";
/** Query answers and the optional promises that narrow their cardinality. */
import { describe, expect, test } from "vite-plus/test";
import {
  former,
  Logging,
  rowsOfAnswer,
  each,
  Reacting,
  vocabulary,
  where,
} from "@sync-engine/internal/reactions";

class BalancesConcept {
  static readonly queries = {
    _balance: "one",
    _entries: "many",
    _latest: "optional",
  } as const;
  entries: { owner: string; amount: number }[] = [];

  credit({ owner, amount }: { owner: string; amount: number }) {
    this.entries.push({ owner, amount });
    return { owner };
  }

  _balance({ owner }: { owner: string }): { owner: string; total: number } {
    const total = this.entries
      .filter((entry) => entry.owner === owner)
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { owner, total };
  }

  _entries({ owner }: { owner: string }): { amount: number }[] {
    return this.entries.filter((entry) => entry.owner === owner).map(({ amount }) => ({ amount }));
  }

  _latest({ owner }: { owner: string }): { amount: number }[] {
    return this._entries({ owner }).slice(-1);
  }
}

class BrokenConcept {
  static readonly queries = { _scalar: "one", _mixedRows: "many" } as const;
  _scalar(_: Record<string, never>): { value: number } {
    return 1 as unknown as { value: number };
  }

  _mixedRows(_: Record<string, never>): { value: number }[] {
    return [{ value: 1 }, null] as unknown as { value: number }[];
  }
}

class UndeclaredQueriesConcept {
  _single(_: Record<string, never>): { value: number } {
    return { value: 1 };
  }

  _rows(_: Record<string, never>): { value: number }[] {
    return [{ value: 1 }, { value: 2 }];
  }
}

const testVocabulary = vocabulary({
  concepts: {
    Balances: { class: BalancesConcept },
    Broken: { class: BrokenConcept },
    UndeclaredQueries: { class: UndeclaredQueriesConcept },
  },
});
const BalancesReads = testVocabulary.concepts.Balances;
const BrokenReads = testVocabulary.concepts.Broken;
const UndeclaredReads = testVocabulary.concepts.UndeclaredQueries;

function setup<T extends object>(instance: T, name: string): { reacting: Reacting; concept: T } {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  return { reacting, concept: reacting.instrument({ [name]: instance })[name] as T };
}

describe("query answers", () => {
  test("a one query answers its record", async () => {
    const { reacting, concept: Balances } = setup(new BalancesConcept(), "Balances");
    await (
      Balances as unknown as BalancesConcept & { credit: (i: object) => Promise<unknown> }
    ).credit({ owner: "amara", amount: 3 });

    const balance = former("balance (owner)", ({ owner }, { total }) =>
      where(BalancesReads._balance({ owner }).is({ total })).form({ total }),
    );
    expect(await reacting.form(balance({ owner: "amara" }))).toEqual({ total: 3 });
  });

  test("a many query answers an array", async () => {
    const { reacting } = setup(new BalancesConcept(), "Balances");
    const entries = former("entries (owner)", ({ owner }, { amount }) =>
      each(BalancesReads._entries({ owner }).is({ amount })).form({ amount }),
    );
    expect(await reacting.form(entries({ owner: "amara" }))).toEqual([]);
  });

  test("an optional query can shape an optional record", async () => {
    const { reacting, concept: Balances } = setup(new BalancesConcept(), "Balances");
    const latest = former("latest (owner)", ({ owner }, { amount }) =>
      where(BalancesReads._latest({ owner }).is({ amount })).form({ amount }),
    ).optional();
    expect(await reacting.form(latest({ owner: "amara" }))).toBeNull();
    await (
      Balances as unknown as BalancesConcept & { credit: (input: object) => Promise<unknown> }
    ).credit({ owner: "amara", amount: 7 });
    expect(await reacting.form(latest({ owner: "amara" }))).toEqual({ amount: 7 });
  });

  test("a scalar query answer raises a query fault", async () => {
    const { reacting, concept: Broken } = setup(new BrokenConcept(), "Broken");
    const scalar = former("scalar ()", (_inputs, { value }) =>
      where(lineOf({ query: Broken._scalar }, {}).is({ value })).form({ value }),
    );
    await expect(reacting.form(scalar({}))).rejects.toThrow('promises "one"');
    await expect(reacting.form(scalar({}))).rejects.toThrow("Broken._scalar");
  });

  test("every member of a many answer must be a record", async () => {
    const { reacting } = setup(new BrokenConcept(), "Broken");
    const rows = former("rows ()", (_inputs, { value }) =>
      each(BrokenReads._mixedRows({}).is({ value })).form({ value }),
    );
    await expect(reacting.form(rows({}))).rejects.toThrow("row 2 is null");
  });

  test("an undeclared query accepts one record or an array of records", async () => {
    const { reacting } = setup(new UndeclaredQueriesConcept(), "UndeclaredQueries");
    const single = former("single rows ()", (_inputs, { value }) =>
      each(UndeclaredReads._single({}).is({ value })).form({ value }),
    );
    const rows = former("rows ()", (_inputs, { value }) =>
      each(UndeclaredReads._rows({}).is({ value })).form({ value }),
    );

    expect(await reacting.form(single({}))).toEqual([{ value: 1 }]);
    expect(await reacting.form(rows({}))).toEqual([{ value: 1 }, { value: 2 }]);
  });
});

describe("query answer normalization", () => {
  test("accepts record answers and arrays of record answers", () => {
    expect(rowsOfAnswer({ a: 1 }, {})).toEqual([{ a: 1 }]);
    expect(rowsOfAnswer([{ a: 1 }, { a: 2 }], {})).toEqual([{ a: 1 }, { a: 2 }]);
    expect(rowsOfAnswer([], {})).toEqual([]);
  });

  test("enforces the optional promise", () => {
    expect(rowsOfAnswer([], { queryPromise: "optional" })).toEqual([]);
    expect(rowsOfAnswer([{ a: 1 }], { queryPromise: "optional" })).toEqual([{ a: 1 }]);
    expect(() => rowsOfAnswer([{ a: 1 }, { a: 2 }], { queryPromise: "optional" })).toThrow(
      "at most one",
    );
  });

  test("rejects other answer shapes", () => {
    expect(() => rowsOfAnswer(null, {})).toThrow("null");
    expect(() => rowsOfAnswer(undefined, {})).toThrow("undefined");
    expect(() => rowsOfAnswer([1], {})).toThrow("row 1 is number");
  });
});
