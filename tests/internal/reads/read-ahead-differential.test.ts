/**
 * Reading rows together must not change what an evaluation answers. Each case
 * builds the same randomly generated data twice and runs the same shape once
 * reading rows one after another and once with `concurrentReads`, then compares
 * the answer or the fault, and how many row-limit breaches were recorded. A
 * shape is a former formed with `app.form`, or reactions fired by an action,
 * compared by the then-calls recorded in order and the failures reported. Reads
 * finish after a random number of microtask turns, so later rows often answer
 * first; some answer at once, and some fail by throwing at once. A few fixed
 * cases pin the answers of shapes whose evaluation both paths share.
 */
import { describe, expect, test, vi } from "vite-plus/test";
import { vocabulary } from "@sync-engine/advanced";
import {
  compute,
  count,
  each,
  form,
  former,
  is,
  no,
  reaction,
  view,
  when,
  where,
  whether,
} from "@sync-engine/language";
import type { Empty } from "@sync-engine/internal/reactions/types";
import type { ExecutionLimits } from "@sync-engine/boundary";
import type {
  OperationalEvent,
  RawFaultReport,
} from "@sync-engine/internal/reactions/runtime/operational";
import type { QueryCacheMode } from "@sync-engine/internal/reactions/runtime/instrumenting";
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
  /** Per item, the kind of label it avoids. */
  items: { avoid: number }[];
  labels: number[][];
  /** Notes per label, and marks per note; two marks break the mark view's promise. */
  notes: Record<string, number>;
  marks: Record<string, number>;
  /** Microtask turns before a read answers; a read of 0 turns answers at once. */
  turns: Record<string, number>;
  /** Reads that fail by throwing at once or by rejecting later; a failing computation throws. */
  failing: Record<string, "throws" | "rejects">;
  maxRows?: number;
  queryCache: QueryCacheMode;
}

function generate(seed: number): Data {
  const random = generator(seed);
  const items = Array.from({ length: random.int(9) }, () => ({ avoid: random.int(3) }));
  const labels = items.map(() => Array.from({ length: random.int(7) }, () => random.int(8)));
  const notes: Record<string, number> = {};
  const marks: Record<string, number> = {};
  const turns: Record<string, number> = {};
  // Keys of what may fail, by kind, so a shape reading only some kinds still meets faults.
  const kinds: string[][] = [[], [], [], []];
  items.forEach((_, item) => {
    turns[`detail ${item}`] = random.int(6);
    kinds[0].push(`detail ${item}`);
    for (const number of labels[item]) {
      const label = `${item}.${number}`;
      notes[label] = random.next() < 0.1 ? 3 + random.int(6) : random.int(3);
      turns[`note ${label}`] = random.int(6);
      kinds[1].push(`note ${label}`);
      kinds[2].push(`weigh ${label}`);
      for (let index = 0; index < notes[label]; index += 1) {
        const note = `${label}/${index}`;
        marks[note] = random.next() < 0.06 ? 2 : random.int(2);
        turns[`mark ${note}`] = random.int(6);
        kinds[3].push(`mark ${note}`);
      }
    }
  });
  const failing: Data["failing"] = {};
  const present = kinds.filter((keys) => keys.length > 0);
  if (present.length > 0 && random.next() < 0.45) {
    for (let fault = 1 + random.int(3); fault > 0; fault -= 1) {
      const keys = present[random.int(present.length)];
      failing[keys[random.int(keys.length)]] = random.next() < 0.4 ? "throws" : "rejects";
    }
  }
  // A limit usually above the item count, so most breaches happen in rows read together.
  const maxRows = random.next() < 0.5 ? Math.max(2, items.length - 1 + random.int(7)) : undefined;
  const queryCache = random.next() < 0.5 ? "memoize" : "none";
  return { items, labels, notes, marks, turns, failing, maxRows, queryCache };
}

async function after(turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

function build(data: Data) {
  /** Answer a read after its turns, or fail as the data says; a sync answer is not a promise. */
  function read<Row>(key: string, rows: () => Row[]): Row[] | Promise<Row[]> {
    const failure = data.failing[key];
    if (failure === "throws") throw new Error(`${key} failed`);
    const turns = data.turns[key] ?? 0;
    if (turns === 0 && failure === undefined) return rows();
    return after(turns).then(() => {
      if (failure !== undefined) throw new Error(`${key} failed`);
      return rows();
    });
  }

  class LedgerConcept {
    static readonly queries = {
      _items: "many",
      _labels: "many",
      _notes: "many",
      _marks: "many",
    } as const;
    recorded: { tag: string; row: unknown }[] = [];

    start(_: Empty) {
      return {};
    }

    record({ tag, row }: { tag: string; row: unknown }) {
      this.recorded.push({ tag, row });
      return {};
    }

    _items(_: Empty) {
      return data.items.map(({ avoid }, item) => ({ item, avoid }));
    }

    _labels({ item }: { item: number }) {
      return read(`detail ${item}`, () =>
        (data.labels[item] ?? []).map((number) => ({
          label: `${item}.${number}`,
          kind: number % 3,
        })),
      );
    }

    _notes({ label }: { label: string }) {
      return read(`note ${label}`, () =>
        Array.from({ length: data.notes[label] ?? 0 }, (_, index) => ({
          note: `${label}/${index}`,
        })),
      );
    }

    _marks({ note }: { note: string }) {
      return read(`mark ${note}`, () =>
        Array.from({ length: data.marks[note] ?? 0 }, (_, index) => ({ mark: index })),
      );
    }
  }
  const words = vocabulary({
    concepts: { Ledger: LedgerConcept },
    computations: {
      weigh: ({ label, n }: { label: string; n: number }) => {
        if (data.failing[`weigh ${label}`] !== undefined) throw new Error(`weigh ${label} failed`);
        return n * 2 + (label.length % 2);
      },
      heavy: ({ weight }: { weight: number }) => weight >= 2,
    },
  });
  const { Ledger } = words.concepts;
  const { weigh, heavy } = words.computations;

  const notesOf = view("the notes of (label)", ({ label }, { note }, _bindings) =>
    where(Ledger._notes({ label }).is({ note })),
  ).many();
  /** A count whose output the view binds. */
  const noteCount = view("the note count of (label)", ({ label }, { n }, _bindings) =>
    where(count(Ledger._notes, { label }, n)),
  ).one();
  /** A count whose output is already bound: an equality test. */
  const hasNotes = view("(label) has (n) notes", ({ label, n }, _outputs, _bindings) =>
    where(count(Ledger._notes, { label }, n)),
  ).holds();
  const markOf = view("the mark of (note)", ({ note }, { mark }, _bindings) =>
    where(Ledger._marks({ note }).is({ mark })),
  ).optional();
  /** Many rows per label, each read through a nested view. */
  const markedNotes = view("the marked notes of (label)", ({ label }, { note, mark }, _bindings) =>
    where(Ledger._notes({ label }).is({ note }), whether(markOf({ note }).is({ mark }))),
  ).many();
  /** A computed output kept by a computation and a standard relation. */
  const weightOf = view("the weight of (label)", ({ label }, { weight }, { n }) =>
    where(
      count(Ledger._notes, { label }, n),
      compute(weigh, { label, n }, weight),
      heavy({ weight }),
      is.lt(n, 2),
    ),
  ).optional();
  const isHeavy = view("(label) is heavy", ({ label }, _outputs, { n, weight }) =>
    where(
      count(Ledger._notes, { label }, n),
      compute(weigh, { label, n }, weight),
      heavy({ weight }),
    ),
  ).holds();

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
    counted: former("counted ()", (_input, { item, label, n }) =>
      each(Ledger._items({}).is({ item }))
        .where(Ledger._labels({ item }).is({ label }), noteCount({ label }).is({ n }))
        .form({ item, label, n }),
    ),
    exactly: former("exactly ()", (_input, { item, label }) =>
      each(Ledger._items({}).is({ item }))
        .where(Ledger._labels({ item }).is({ label }), hasNotes({ label, n: 1 }))
        .form({ item, label }),
    ),
    /** A blank label leaves the later lines' input unbound; the frame passes through. */
    chained: former("chained ()", (_input, { item, label, note, mark }) =>
      each(Ledger._items({}).is({ item }))
        .where(
          whether(Ledger._labels({ item }).is({ label })),
          whether(Ledger._notes({ label }).is({ note })),
          whether(markOf({ note }).is({ mark })),
        )
        .form({ item, label, note, mark }),
    ),
    negated: former("negated ()", (_input, { item, avoid, label, note, mark }) =>
      each(Ledger._items({}).is({ item, avoid }))
        .where(
          Ledger._labels({ item }).is({ label }).is.not({ kind: avoid }),
          Ledger._notes({ label }).is({ note }),
          Ledger._marks({ note }).is({ mark }).is.not({ mark: 1 }),
        )
        .form({ item, label, note, mark }),
    ),
    existing: former("existing ()", (_input, { item, avoid, label }) =>
      each(Ledger._items({}).is({ item, avoid }))
        .where(
          Ledger._labels({ item }).is.not({ kind: avoid }),
          Ledger._labels({ item }).is({ label }),
          Ledger._notes({ label }),
          isHeavy({ label }),
        )
        .form({ item, label }),
    ),
    weighed: former("weighed ()", (_input, { item, label, weight }) =>
      each(Ledger._items({}).is({ item }))
        .where(Ledger._labels({ item }).is({ label }), whether(weightOf({ label }).is({ weight })))
        .form({ item, label, weight }),
    ),
  };

  const card = former("the card of (item)", ({ item }, { label, n, note, mark, weight }) =>
    form({
      item,
      labels: each(Ledger._labels({ item }).is({ label }))
        .where(noteCount({ label }).is({ n }))
        .form({
          label,
          n,
          notes: each(markedNotes({ label }).is({ note, mark })).form({ note, mark }),
        }),
      heavy: each(Ledger._labels({ item }).is({ label }))
        .where(weightOf({ label }).is({ weight }))
        .count(),
      notes: each(Ledger._labels({ item }).is({ label }))
        .where(notesOf({ label }).is({ note }))
        .form({ note }),
    }),
  );
  const reactions = {
    /** Two reactions on one action, each reading many frames before recording one call per frame. */
    reacting: {
      Tally: reaction(({ item, avoid, label, kind, n, note, mark }) =>
        when(Ledger.start({}).responds())
          .where(
            Ledger._items({}).is({ item, avoid }),
            no(Ledger._labels({ item }).is({ kind: avoid })),
            whether(Ledger._labels({ item }).is({ label, kind })),
            whether(noteCount({ label }).is({ n })),
            whether(markedNotes({ label }).is({ note, mark })),
          )
          .then(Ledger.record({ tag: "tally", row: { item, label, kind, n, note, mark } })),
      ),
      Weigh: reaction(({ item, avoid, label, weight, note }) =>
        when(Ledger.start({}).responds())
          .where(
            Ledger._items({}).is({ item, avoid }),
            Ledger._labels({ item }).is({ label }).is.not({ kind: avoid }),
            whether(weightOf({ label }).is({ weight })),
            markedNotes({ label }).is({ note }),
          )
          .then(Ledger.record({ tag: "weigh", row: { item, label, weight, note } })),
      ),
    },
    /** A then input formed per firing through the firing pipeline. */
    carding: {
      Card: reaction(({ item }) =>
        when(Ledger.start({}).responds())
          .where(Ledger._items({}).is({ item }))
          .then(Ledger.record({ tag: "card", row: card({ item }) })),
      ),
    },
  };
  return { words, formers, reactions };
}

type Built = ReturnType<typeof build>;
type FormerName = keyof Built["formers"];
type ReactionsName = keyof Built["reactions"];
type Shape = FormerName | ReactionsName;

const formerNames = Object.keys(build(generate(0)).formers) as FormerName[];
const isFormer = (shape: Shape): shape is FormerName =>
  (formerNames as readonly string[]).includes(shape);

const limits = (maxRows: number | undefined): ExecutionLimits | undefined =>
  maxRows === undefined
    ? undefined
    : {
        maxActiveRootFlows: 4,
        maxPendingRequests: 4,
        maxActionsPerFlow: 10_000,
        maxFiringsPerFlow: 10_000,
        maxRowsPerEvaluation: maxRows,
        maxRequestDurationMs: 5_000,
      };

const ROW_LIMIT = "The evaluation exceeded its row limit.";

/** A raw fault report, without its timing or flow. */
function reported(report: RawFaultReport): string {
  const site =
    report.kind === "interpreter"
      ? `${report.reaction} ${report.stage}`
      : report.kind === "action"
        ? `${report.concept}.${report.action}`
        : report.phase;
  return `${report.kind} ${site}: ${(report.error as Error).message}`;
}

/** What one shape did: a former's answer or fault, or reactions' calls and failures. */
type Outcome = {
  answer?: unknown;
  fault?: string;
  recorded?: unknown[];
  failures: string[];
  breaches: number;
};

/** Rows read together runs in which rows were still ahead when the shape had finished. */
const abandoned = { runs: 0 };

async function outcome(
  data: Data,
  shape: Shape,
  concurrentReads?: ConcurrentReads,
): Promise<Outcome> {
  const { words, formers, reactions } = build(data);
  const events: OperationalEvent[] = [];
  const failures: string[] = [];
  const executionLimits = limits(data.maxRows);
  const app = assemble({
    vocabulary: words,
    composition: isFormer(shape) ? { [shape]: formers[shape] } : reactions[shape],
    retention: { window: 0 },
    queryCache: data.queryCache,
    observers: [(event) => events.push(event)],
    rawFaultReporter: (report) => failures.push(reported(report)),
    ...(executionLimits === undefined ? {} : { executionLimits }),
    ...(concurrentReads === undefined ? {} : { concurrentReads }),
  });
  let result: Pick<Outcome, "answer" | "fault" | "recorded">;
  if (isFormer(shape)) {
    try {
      result = { answer: await app.form(formers[shape]({})) };
    } catch (error) {
      result = { fault: (error as Error).message };
    }
  } else {
    await app.concepts.Ledger.start({});
    await app.whenIdle();
    result = { recorded: app.concepts.Ledger.recorded };
  }
  if (concurrentReads !== undefined) {
    // Rows abandoned after a fault may still be settling; none stays counted once they have.
    await app.whenIdle();
    const ahead = () => app.engine.readEnv().readAhead?.ahead.inUse;
    if (ahead() !== 0) abandoned.runs += 1;
    await vi.waitFor(() => expect(ahead()).toBe(0), { interval: 1 });
  }
  const breaches = events.filter((event) => event.type === "execution-limit-breached").length;
  return { ...result, failures, breaches };
}

const settings: ConcurrentReads[] = [
  { rowsAtOnce: 2 },
  { rowsAtOnce: 3, maxRowsAhead: 1 },
  { rowsAtOnce: 16 },
  { rowsAtOnce: 16, maxRowsAhead: 2 },
];

/** Seeds in which a shape answered without fault or breach, faulted, or breached the row limit. */
interface Coverage {
  answered: number;
  faults: number;
  breaches: number;
}

/** Compare every setting with reading one row at a time; the shares of seeds each shape exercised. */
async function compare(shapes: readonly Shape[], seeds: number): Promise<Record<string, Coverage>> {
  const counts: Record<string, Coverage> = {};
  for (const shape of shapes) counts[shape] = { answered: 0, faults: 0, breaches: 0 };
  for (let seed = 1; seed <= seeds; seed += 1) {
    const data = generate(seed);
    for (const shape of shapes) {
      const sequential = await outcome(data, shape);
      for (const reads of settings) {
        const together = await outcome(data, shape, reads);
        expect(together, `seed ${seed}, ${shape}, ${JSON.stringify(reads)}`).toEqual(sequential);
      }
      const faulted = [sequential.fault ?? ROW_LIMIT, ...sequential.failures].some(
        (message) => !message.endsWith(ROW_LIMIT),
      );
      // A breach counts only past the first line, which reads its one frame alone.
      const past = data.maxRows !== undefined && data.maxRows >= data.items.length;
      if (faulted) counts[shape].faults += 1;
      if (sequential.breaches > 0 && past) counts[shape].breaches += 1;
      if (!faulted && sequential.breaches === 0) counts[shape].answered += 1;
    }
  }
  const shares: Record<string, Coverage> = {};
  for (const [shape, { answered, faults, breaches }] of Object.entries(counts)) {
    shares[shape] = {
      answered: answered / seeds,
      faults: faults / seeds,
      breaches: breaches / seeds,
    };
  }
  return shares;
}

/** Each shape answered, faulted, and breached the row limit in at least these shares of seeds. */
function expectCoverage(
  coverage: Record<string, Coverage>,
  shapes: readonly Shape[],
  floors: Coverage,
): void {
  for (const shape of shapes) {
    for (const measure of ["answered", "faults", "breaches"] as const) {
      expect(coverage[shape][measure], `${shape} ${measure}`).toBeGreaterThanOrEqual(
        floors[measure],
      );
    }
  }
}

describe("reading rows together answers as reading them one after another", () => {
  test("formers over generated data, several windows", { timeout: 120_000 }, async () => {
    const before = abandoned.runs;
    const coverage = await compare(formerNames, 300);

    expectCoverage(coverage, ["found", "optional", "absent", "viewed", "nested"], {
      answered: 0.25,
      faults: 0.1,
      breaches: 0.08,
    });
    expectCoverage(coverage, ["counted", "exactly", "chained", "negated", "existing", "weighed"], {
      answered: 0.25,
      faults: 0.15,
      breaches: 0.18,
    });
    // The check that no row stays ahead also met rows still settling after a fault.
    expect(abandoned.runs - before).toBeGreaterThan(50);
  });

  test(
    "reactions over generated data: where lines, then calls, and then-input formers",
    {
      timeout: 120_000,
    },
    async () => {
      // Every failed reaction logs an error; the failures are compared, not printed.
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const coverage = await compare(["reacting", "carding"], 400);

        expectCoverage(coverage, ["reacting", "carding"], {
          answered: 0.25,
          faults: 0.3,
          breaches: 0.12,
        });
      } finally {
        logged.mockRestore();
      }
    },
  );
});

/** Data with no faults or limits, read at once unless `turns` says otherwise. */
function fixed(shape: Partial<Data> & Pick<Data, "items" | "labels" | "notes">): Data {
  return { marks: {}, turns: {}, failing: {}, queryCache: "memoize", ...shape };
}

describe("both paths share how a line consumes a frame's rows", () => {
  const read = async (data: Data, name: FormerName) => {
    const sequential = await outcome(data, name);
    for (const reads of settings) expect(await outcome(data, name, reads)).toEqual(sequential);
    return sequential.answer;
  };

  test("count with its output already bound keeps only the frames whose count equals it", async () => {
    const data = fixed({
      items: [{ avoid: 0 }, { avoid: 0 }],
      labels: [[1, 2], [3]],
      notes: { "0.1": 1, "0.2": 2, "1.3": 1 },
      turns: { "detail 0": 2, "note 0.1": 3, "note 0.2": 1 },
    });

    expect(await read(data, "exactly")).toEqual([
      { item: 0, label: "0.1" },
      { item: 1, label: "1.3" },
    ]);
    expect(await read(data, "counted")).toEqual([
      { item: 0, label: "0.1", n: 1 },
      { item: 0, label: "0.2", n: 2 },
      { item: 1, label: "1.3", n: 1 },
    ]);
  });

  test("whether passes a frame through unchanged when its input is unbound", async () => {
    const data = fixed({
      items: [{ avoid: 0 }, { avoid: 0 }, { avoid: 0 }],
      labels: [[], [4], []],
      notes: { "1.4": 1 },
      marks: { "1.4/0": 1 },
      turns: { "detail 0": 3, "note 1.4": 2 },
    });

    expect(await read(data, "chained")).toEqual([
      { item: 0, label: null, note: null, mark: null },
      { item: 1, label: "1.4", note: "1.4/0", mark: 0 },
      { item: 2, label: null, note: null, mark: null },
    ]);
  });
});
