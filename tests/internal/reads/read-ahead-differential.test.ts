/**
 * Reading rows together must not change what a former answers. Each case
 * builds the same randomly generated data twice, forms the same former once
 * reading rows one after another and once with `concurrentReads`, and compares
 * the answer or the fault, and how many row-limit breaches were recorded. Reads
 * finish after a random number of turns, so later rows often answer first.
 */
import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import { each, former, no, view, where, whether } from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ExecutionLimits } from "@sync-engine/boundary";
import type { OperationalEvent } from "@sync-engine/internal/reactions/runtime/operational";
import type { ConcurrentReads } from "@sync-engine/internal/reads/where-evaluation";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

/** A small seeded generator, so a failing case can be replayed from its seed. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (below: number) => Math.floor(next() * below) };
}

interface Data {
  items: number;
  labels: number[][];
  notes: Record<string, number>;
  turns: Record<string, number>;
  failing?: string;
  maxRows?: number;
}

function generate(seed: number): Data {
  const random = generator(seed);
  const items = random.int(9);
  const labels = Array.from({ length: items }, () =>
    Array.from({ length: random.int(7) }, () => random.int(8)),
  );
  const notes: Record<string, number> = {};
  const turns: Record<string, number> = {};
  for (let item = 0; item < items; item += 1) {
    turns[`detail ${item}`] = random.int(6);
    for (const label of labels[item]) {
      notes[`${item}.${label}`] = random.int(3);
      turns[`note ${item}.${label}`] = random.int(6);
    }
  }
  const keys = Object.keys(turns);
  const failing =
    keys.length > 0 && random.next() < 0.3 ? keys[random.int(keys.length)] : undefined;
  const maxRows = random.next() < 0.5 ? 2 + random.int(8) : undefined;
  return { items, labels, notes, turns, failing, maxRows };
}

async function after(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

function build(data: Data) {
  class LedgerConcept {
    static readonly queries = { _items: "many", _labels: "many", _notes: "many" } as const;

    _items(_: Empty) {
      return Array.from({ length: data.items }, (_, item) => ({ item }));
    }

    async _labels({ item }: { item: number }) {
      const key = `detail ${item}`;
      await after(data.turns[key] ?? 0);
      if (data.failing === key) throw new Error(`${key} failed`);
      return (data.labels[item] ?? []).map((label) => ({ label: `${item}.${label}` }));
    }

    async _notes({ label }: { label: string }) {
      const key = `note ${label}`;
      await after(data.turns[key] ?? 0);
      if (data.failing === key) throw new Error(`${key} failed`);
      return Array.from({ length: data.notes[label] ?? 0 }, (_, index) => ({
        note: `${label}/${index}`,
      }));
    }
  }
  const words = vocabulary({ concepts: { Ledger: LedgerConcept }, computations: {} });
  const { Ledger } = words.concepts;
  const notesOf = view("the notes of (label)", ({ label }, { note }, _bindings) =>
    where(Ledger._notes({ label }).is({ note })),
  ).many();
  const formers = {
    found: former("found ()", (_input, { item, label }) =>
      each(Ledger._items({}).is({ item }))
        .where(Ledger._labels({ item }).is({ label }))
        .form({ item, label }),
    ),
    optional: former("optional ()", (_input, { item, label }) =>
      each(Ledger._items({}).is({ item }))
        .where(whether(Ledger._labels({ item }).is({ label })))
        .form({ item, label }),
    ),
    absent: former("absent ()", (_input, { item }) =>
      each(Ledger._items({}).is({ item }))
        .where(no(Ledger._labels({ item })))
        .form({ item }),
    ),
    viewed: former("viewed ()", (_input, { item, label, note }) =>
      each(Ledger._items({}).is({ item }))
        .where(Ledger._labels({ item }).is({ label }), notesOf({ label }).is({ note }))
        .form({ item, note }),
    ),
    nested: former("nested ()", (_input, { item, label, note }) =>
      each(Ledger._items({}).is({ item })).form({
        item,
        labels: each(Ledger._labels({ item }).is({ label })).form({
          label,
          notes: each(Ledger._notes({ label }).is({ note })).form({ note }),
          noteCount: each(Ledger._notes({ label }).is({ note })).count(),
        }),
      }),
    ),
  };
  return { words, formers };
}

const limits = (maxRows: number | undefined): ExecutionLimits | undefined =>
  maxRows === undefined
    ? undefined
    : {
        maxActiveRootFlows: 4,
        maxPendingRequests: 4,
        maxActionsPerFlow: 100,
        maxFiringsPerFlow: 100,
        maxRowsPerEvaluation: maxRows,
        maxRequestDurationMs: 5_000,
      };

type Outcome = { answer?: unknown; fault?: string; breaches: number };

async function outcome(
  data: Data,
  name: keyof ReturnType<typeof build>["formers"],
  concurrentReads?: ConcurrentReads,
): Promise<Outcome> {
  const { words, formers } = build(data);
  const events: OperationalEvent[] = [];
  const executionLimits = limits(data.maxRows);
  const app = assemble({
    vocabulary: words,
    composition: formers,
    retention: { window: 0 },
    observers: [(event) => events.push(event)],
    ...(executionLimits === undefined ? {} : { executionLimits }),
    ...(concurrentReads === undefined ? {} : { concurrentReads }),
  });
  const breaches = () => events.filter((event) => event.type === "execution-limit-breached").length;
  try {
    return { answer: await app.form(formers[name]({})), breaches: breaches() };
  } catch (error) {
    return { fault: (error as Error).message, breaches: breaches() };
  }
}

const settings: ConcurrentReads[] = [
  { window: 2 },
  { window: 3, maxRowsAhead: 1 },
  { window: 16 },
  { window: 16, maxRowsAhead: 2 },
];

describe("reading rows together answers as reading them one after another", () => {
  test("over generated data, every former, and several windows", async () => {
    const names = ["found", "optional", "absent", "viewed", "nested"] as const;
    let faults = 0;
    let breaches = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const data = generate(seed);
      for (const name of names) {
        const sequential = await outcome(data, name);
        if (sequential.fault !== undefined) faults += 1;
        if (sequential.breaches > 0) breaches += 1;
        for (const reads of settings) {
          const together = await outcome(data, name, reads);
          expect(together, `seed ${seed}, ${name}, ${JSON.stringify(reads)}`).toEqual(sequential);
        }
      }
    }
    // The generated cases exercise faults and row limits, not only answers.
    expect(faults).toBeGreaterThan(50);
    expect(breaches).toBeGreaterThan(50);
  });
});
