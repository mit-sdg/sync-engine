import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Query and view conditions. These tests cover output binding and matching,
 * `no`, `whether`, declared row counts, view outputs, former result shapes,
 * and generated read-backs.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  $vars,
  applyWhereOps,
  each,
  former,
  Frames,
  is,
  isReadLine,
  Logging,
  no,
  reaction,
  Reacting,
  form,
  type Vars,
  view,
  vocabulary,
  when,
  where,
  whether,
} from "@sync-engine/internal/reactions";

// ── Declared query promises ────────────────────────────────────────────────

interface PostRow {
  post: string;
  author: string;
  locked: boolean;
}

class PostingConcept {
  static readonly queries = { _getPost: "optional", _byAuthor: "many" } as const;
  posts: PostRow[] = [];
  create({ post, author }: { post: string; author: string }) {
    this.posts.push({ post, author, locked: false });
    return { post };
  }
  lock({ post }: { post: string }) {
    const found = this.posts.find((row) => row.post === post);
    if (found !== undefined) found.locked = true;
    return { post };
  }
  _getPost({ post }: { post: string }): PostRow[] {
    return this.posts.filter((row) => row.post === post);
  }
  _byAuthor({ author }: { author: string }): PostRow[] {
    return this.posts.filter((row) => row.author === author);
  }
}

class TimingConcept {
  static readonly queries = { _now: "one" } as const;
  at = 100;
  tick(_: Record<string, never>) {
    return {};
  }
  _now(): { at: number } {
    return { at: this.at };
  }
}

class GradingConcept {
  static readonly queries = { _gradeOf: "optional" } as const;
  grades = new Map<string, number>();
  grade({ submission, score }: { submission: string; score: number }) {
    this.grades.set(submission, score);
    return { submission };
  }
  _gradeOf({ submission }: { submission: string }): { score: number }[] {
    const score = this.grades.get(submission);
    return score === undefined ? [] : [{ score }];
  }
}

class RecordingConcept {
  order: unknown[] = [];
  note({ tag }: { tag: unknown }) {
    this.order.push(tag);
    return {};
  }
}

const words = vocabulary({
  concepts: {
    Posting: { class: PostingConcept },
    Timing: { class: TimingConcept },
    Grading: { class: GradingConcept },
    Recording: { class: RecordingConcept },
  },
});
const { Posting, Timing, Grading, Recording } = words.concepts;

function build() {
  const engine = new Reacting();
  engine.logging = Logging.OFF;
  const live = {
    Posting: engine.instrumentConcept(new PostingConcept(), "Posting"),
    Timing: engine.instrumentConcept(new TimingConcept(), "Timing"),
    Grading: engine.instrumentConcept(new GradingConcept(), "Grading"),
    Recording: engine.instrumentConcept(new RecordingConcept(), "Recording"),
  };
  return { engine, ...live };
}

// ── The callable vocabulary proxy ──────────────────────────────────────────

describe("the callable proxy", () => {
  test("a called query ref returns a typed condition line", () => {
    const { post, author } = $vars;
    const line = Posting._getPost({ post });
    expect(isReadLine(line)).toBe(true);
    const opened = line.is({ author });
    expect(isReadLine(opened)).toBe(true);
    const denied = opened.is.not({ author: "sam" });
    expect(isReadLine(denied)).toBe(true);
  });

  test("an action ref answers a requested action line", () => {
    const line = Posting.create({ post: "p", author: "sam" });
    expect(line.action.action).toBe(Posting.create);
    expect(line.action.input).toEqual({ post: "p", author: "sam" });
  });
});

// ── The unification table: a literal or bound name tests, a fresh name opens ─

describe("per-slot unification", () => {
  test("fresh names open, bound names test, literals test — one reaction each", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "sam" });
    const { post, author } = $vars;

    // fresh: opens
    const opened = await applyWhereOps(
      new Frames({ [post]: "p1" }),
      [lineOf({ query: Posting._getPost }, { post }).is({ author }) as never],
      engine.readEnv(),
    );
    expect(opened[0][author]).toBe("priya");

    // bound: tests — a conflicting row drops the case
    const conflicted = await applyWhereOps(
      new Frames({ [post]: "p1", [author]: "sam" }),
      [lineOf({ query: Posting._getPost }, { post }).is({ author }) as never],
      engine.readEnv(),
    );
    expect(conflicted.length).toBe(0);

    // literal: tests
    const literal = await applyWhereOps(
      new Frames({ [post]: "p2" }),
      [lineOf({ query: Posting._getPost }, { post }).is({ author: "sam" }) as never],
      engine.readEnv(),
    );
    expect(literal.length).toBe(1);
  });

  test("using the same variable in two output patterns tests equality", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "priya" });
    await posting.create({ post: "p3", author: "sam" });
    const { author, a, b } = $vars;

    const sameAuthor = await applyWhereOps(
      new Frames({ [a]: "p1", [b]: "p2" }),
      [
        lineOf({ query: Posting._getPost }, { post: a }).is({ author }) as never,
        lineOf({ query: Posting._getPost }, { post: b }).is({ author }) as never,
      ],
      engine.readEnv(),
    );
    expect(sameAuthor.length).toBe(1);

    const different = await applyWhereOps(
      new Frames({ [a]: "p1", [b]: "p3" }),
      [
        lineOf({ query: Posting._getPost }, { post: a }).is({ author }) as never,
        lineOf({ query: Posting._getPost }, { post: b }).is({ author }) as never,
      ],
      engine.readEnv(),
    );
    expect(different.length).toBe(0);
  });

  test("the promise governs firing: many fans out per distinct fill", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "priya" });
    const { post } = $vars;
    const fills = await applyWhereOps(
      new Frames({}),
      [lineOf({ query: Posting._byAuthor }, { author: "priya" }).is({ post }) as never],
      engine.readEnv(),
    );
    expect(
      fills.map((frame) => String(frame[post])).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(["p1", "p2"]);
  });
});

// ── The closed pattern forms ───────────────────────────────────────────────

describe("the closed patterns", () => {
  test("a bare call is existence — fires once or drops the case", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "priya" });
    const exists = await applyWhereOps(
      new Frames({}),
      [Posting._byAuthor({ author: "priya" }) as never],
      engine.readEnv(),
    );
    expect(exists.length).toBe(1);
    const dropped = await applyWhereOps(
      new Frames({}),
      [Posting._byAuthor({ author: "nobody" }) as never],
      engine.readEnv(),
    );
    expect(dropped.length).toBe(0);
  });

  test("no is one reading — no such row exists at all", async () => {
    const { engine, Grading: grading } = build();
    const { submission } = $vars;
    const ungraded = await applyWhereOps(
      new Frames({ [submission]: "s1" }),
      [no(Grading._gradeOf({ submission })) as never],
      engine.readEnv(),
    );
    expect(ungraded.length).toBe(1);
    await grading.grade({ submission: "s1", score: 90 });
    const graded = await applyWhereOps(
      new Frames({ [submission]: "s1" }),
      [no(Grading._gradeOf({ submission })) as never],
      engine.readEnv(),
    );
    expect(graded.length).toBe(0);
  });

  test("whether binds or leaves blank, and the case proceeds either way", async () => {
    const { engine, Grading: grading } = build();
    await grading.grade({ submission: "s1", score: 90 });
    const { submission, score } = $vars;
    const bound = await applyWhereOps(
      new Frames({ [submission]: "s1" }),
      [whether(lineOf({ query: Grading._gradeOf }, { submission }).is({ score })) as never],
      engine.readEnv(),
    );
    expect(bound[0][score]).toBe(90);
    const blank = await applyWhereOps(
      new Frames({ [submission]: "s2" }),
      [whether(lineOf({ query: Grading._gradeOf }, { submission }).is({ score })) as never],
      engine.readEnv(),
    );
    expect(blank.length).toBe(1);
    expect(score in blank[0]).toBe(false);
  });

  test(".is.not states negated slot tests over bound names and literals", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    const { post, user } = $vars;
    const differs = await applyWhereOps(
      new Frames({ [post]: "p1", [user]: "sam" }),
      [Posting._getPost({ post }).is.not({ author: user }) as never],
      engine.readEnv(),
    );
    expect(differs.length).toBe(1);
    const same = await applyWhereOps(
      new Frames({ [post]: "p1", [user]: "priya" }),
      [Posting._getPost({ post }).is.not({ author: user }) as never],
      engine.readEnv(),
    );
    expect(same.length).toBe(0);
  });

  test("bare comparisons are ordinary closed lines", async () => {
    const { due, at } = $vars;
    const holds = await applyWhereOps(new Frames({ [due]: 5, [at]: 9 }), [is.lt(due, at) as never]);
    expect(holds.length).toBe(1);
    const fails = await applyWhereOps(new Frames({ [due]: 9, [at]: 5 }), [is.le(due, at) as never]);
    expect(fails.length).toBe(0);
  });

  test("no and whether reject a line that uses .is.not", () => {
    const { post, user } = $vars;
    expect(() => no(Posting._getPost({ post }).is.not({ author: user }))).toThrow(
      "no(...) and whether(...) cannot wrap a line that uses .is.not(...)",
    );
    expect(() => whether(Posting._getPost({ post }).is.not({ author: user }))).toThrow(
      "no(...) and whether(...) cannot wrap a line that uses .is.not(...)",
    );
  });
});

// ── Registration checks: orderless conjunction and binding use ────

describe("registration checks", () => {
  test("conjunction is orderless — line order is a legibility choice", async () => {
    const { engine, Posting: posting, Recording: recording } = build();
    engine.register({
      // The comparison is stated before the line that opens `at` — the
      // schedule, not the author, carries evaluation order.
      LockLate: reaction(({ post, at }: Vars) =>
        when(Posting.lock, { post })
          .where(is.lt(50, at), lineOf({ query: Timing._now }, {}).is({ at }))
          .then(request(Recording.note, { tag: post })),
      ),
    });
    await posting.create({ post: "p1", author: "priya" });
    await posting.lock({ post: "p1" });
    expect(recording.order).toEqual(["p1"]);
  });

  test("no cannot introduce a new name", () => {
    const { engine } = build();
    expect(() =>
      engine.register({
        NewNameInsideNo: reaction(({ post, ghost }: Vars) =>
          when(Posting.create, {}, { post })
            .where(no(lineOf({ query: Posting._getPost }, { post }).is({ author: ghost })))
            .then(request(Recording.note, { tag: post })),
        ),
      }),
    ).toThrow("no(...) can only test names bound by an earlier plain line");
  });

  test("a name opened and never used is an error — omit the key instead", () => {
    const { engine } = build();
    expect(() =>
      engine.register({
        OpensUnused: reaction(({ post, author }: Vars) =>
          when(Posting.create, {}, { post })
            .where(lineOf({ query: Posting._getPost }, { post }).is({ author }))
            .then(request(Recording.note, { tag: post })),
        ),
      }),
    ).toThrow("opened and never used");
  });

  test("formed values are not conditions", () => {
    const { engine } = build();
    expect(() =>
      engine.register({
        ShapeInWhere: reaction(({ post, author }: Vars) =>
          when(Posting.create, {}, { post })
            .where(form({ author }) as never)
            .then(request(Recording.note, { tag: author })),
        ),
      }),
    ).toThrow("each condition is a line");
  });
});

// ── Views are relations ────────────────────────────────────────────────────

const authorOf = view("the author of (post)", ({ post }, { author }, _bindings) =>
  where(lineOf({ query: Posting._getPost }, { post }).is({ author })),
).optional();

const isUnlocked = view("(post) is unlocked", ({ post }, _outputs, _bindings) =>
  where(lineOf({ query: Posting._getPost }, { post }).is({ locked: false })),
).holds();

describe("views as relations", () => {
  test("a view line is indistinguishable from a concept query at the use-site", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    const { post, author } = $vars;
    const opened = await applyWhereOps(
      new Frames({ [post]: "p1" }),
      [authorOf({ post }).is({ author }) as never],
      engine.readEnv(),
    );
    expect(opened[0][author]).toBe("priya");
    const missing = await applyWhereOps(
      new Frames({ [post]: "p9" }),
      [authorOf({ post }).is({ author }) as never],
      engine.readEnv(),
    );
    expect(missing.length).toBe(0);
  });

  test("a predicate view holds or drops; no(view(...)) is supported uniformly", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.lock({ post: "p1" });
    const { post } = $vars;
    const locked = await applyWhereOps(
      new Frames({ [post]: "p1" }),
      [isUnlocked({ post }) as never],
      engine.readEnv(),
    );
    expect(locked.length).toBe(0);
    const denied = await applyWhereOps(
      new Frames({ [post]: "p1" }),
      [no(isUnlocked({ post })) as never],
      engine.readEnv(),
    );
    expect(denied.length).toBe(1);
  });

  test("runtime enforcement names a view whose answer violates its promise", async () => {
    const overclaims = view("the only post of (author)", ({ author }, { post }, _bindings) =>
      where(lineOf({ query: Posting._byAuthor }, { author }).is({ post })),
    ).one();
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "priya" });
    const { post } = $vars;
    await expect(
      applyWhereOps(
        new Frames({}),
        [overclaims({ author: "priya" }).is({ post }) as never],
        engine.readEnv(),
      ),
    ).rejects.toThrow('View "the only post of (author)" promises one row but produced 2.');
  });

  test("a view output must be bound by the view body", () => {
    expect(() =>
      view("the author of (post)", ({ post }, { writer }, { author }) => [
        where(lineOf({ query: Posting._getPost }, { post }).is({ author: writer })),
        where(lineOf({ query: Posting._getPost }, { post }).is({ author })),
      ]).optional(),
    ).toThrow('an alternative never binds output binding "writer"');
    expect(() =>
      view("the author of (post)", ({ post }, { author: _author }, { post: repeated }) =>
        where(Posting._getPost({ post }).is({ author: repeated })),
      ).optional(),
    ).toThrow('"post" is declared in both the input and free binding bags');
    expect(() =>
      view("the author of (post)", ({ post }, _outputs, _bindings) =>
        where(Posting._getPost({ post })),
      ).optional(),
    ).toThrow("optional() requires at least one output binding");
  });

  test("imported view IR names a repeated output in its declaration error", () => {
    const { engine } = build();
    expect(() =>
      engine.registerViews([
        {
          name: "posts by an author",
          ins: ["author"],
          outs: ["post", "post"],
          bindings: [],
          promise: "many",
          alternatives: [],
        },
      ]),
    ).toThrow('"post" is declared in both the output and output binding bags');
  });

  test("a sentence view accepts its declared inputs", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    const { post } = $vars;
    const held = await applyWhereOps(
      new Frames({ [post]: "p1" }),
      [isUnlocked({ post })],
      engine.readEnv(),
    );
    expect(held.length).toBe(1);
    expect(() => isUnlocked({ posts: post })).toThrow('"posts" is not an input');
    expect(() => isUnlocked({})).toThrow('required input "post" is missing');
  });

  test("a view with outputs declares its promise — there is no default", () => {
    const { engine } = build();
    expect(() =>
      engine.registerViews([
        {
          name: "outsNoPromise",
          ins: ["post"],
          outs: ["author"],
          bindings: [],
          alternatives: [
            [
              {
                op: "find",
                query: { concept: "Posting", query: "_getPost" },
                in: { post: { $var: "post" } },
                out: { author: { $var: "author" } },
              },
            ],
          ],
        },
      ]),
    ).toThrow("must carry its one, optional, or many promise");
  });

  test("views form a DAG — a cycle is rejected and printed", () => {
    const { engine } = build();
    const line = (target: string) => [
      { op: "find" as const, view: target, in: { x: { $var: "x" } }, out: {} },
    ];
    expect(() =>
      engine.registerViews([
        {
          name: "a",
          ins: ["x"],
          outs: [],
          bindings: [],
          holds: true,
          alternatives: [line("b")],
        },
        {
          name: "b",
          ins: ["x"],
          outs: [],
          bindings: [],
          holds: true,
          alternatives: [line("a")],
        },
      ]),
    ).toThrow("cycle: a → b → a");
  });
});

// ── Former result shapes ──────────────────────────────────────────────────

describe("former result shapes", () => {
  test("one(...) faults on absence, whether(...) forms blank leaves, plain drops the row", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });

    const face = former("the face of (post)", ({ post }, { author }) =>
      where(lineOf({ query: Posting._getPost }, { post }).is({ author })).form({ author }),
    );
    const maybeFace = former("the possible face of (post)", ({ post }, { author }) =>
      where(whether(lineOf({ query: Posting._getPost }, { post }).is({ author }))).form({ author }),
    );
    const presentFace = former("the present face of (post)", ({ post }, { author }) =>
      where(lineOf({ query: Posting._getPost }, { post }).is({ author })).form({ author }),
    ).optional();

    expect(await engine.form(face({ post: "p1" }))).toEqual({ author: "priya" });
    await expect(engine.form(face({ post: "p9" }))).rejects.toThrow("FORMER_NONE");
    expect(await engine.form(maybeFace({ post: "p9" }))).toEqual({ author: null });
    expect(await engine.form(presentFace({ post: "p1" }))).toEqual({ author: "priya" });
    expect(await engine.form(presentFace({ post: "p9" }))).toBeNull();
    engine.declareFormers(face);
    expect(engine.readBack()).toContain(
      "the face of (post) — inputs (post); bindings (author); promises exactly one; the body proves at most one — the declaration is enforced at run",
    );
  });

  test("folds reject sources that promise at most one row", async () => {
    const { engine } = build();
    const possibleAuthor = former("the possible author of (post)", ({ post }, { author }) =>
      each(lineOf({ query: Posting._getPost }, { post }).is({ author })).first(author),
    );
    await expect(engine.form(possibleAuthor({ post: "p1" }))).rejects.toThrow(
      "source already promises at most one row",
    );
  });

  test("a formed record rejects a source that may match many rows", async () => {
    const { engine } = build();
    const ambiguous = former("an ambiguous author (author)", ({ author }, { post }) =>
      where(Posting._byAuthor({ author }).is({ post })).form({ post }),
    );
    await expect(engine.form(ambiguous({ author: "priya" }))).rejects.toThrow(
      "this record's where may match many rows",
    );
  });

  test("whether(...) returns a read condition, not a selection chain", () => {
    const { post, author } = $vars;
    const optionalRead = whether(lineOf({ query: Posting._getPost }, { post }).is({ author }));
    type HasSelectionConsumer = "first" extends keyof typeof optionalRead ? true : false;
    const hasSelectionConsumer: HasSelectionConsumer = false;

    expect(hasSelectionConsumer).toBe(false);
    expect("where" in optionalRead).toBe(false);
    expect("arranged" in optionalRead).toBe(false);
    expect("first" in optionalRead).toBe(false);
    expect("as" in optionalRead).toBe(false);
    expect("count" in optionalRead).toBe(false);
    expect("distinct" in optionalRead).toBe(false);
  });

  test("a query selection schedules orderless refinements, including a derived view", async () => {
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    const selected = former("the posts selected for (wanted)", ({ wanted }, { post, author }) =>
      each(lineOf({ query: Posting._byAuthor }, { author: wanted }).is({ post }))
        .where(Posting._byAuthor({ author }).is({ post }), authorOf({ post }).is({ author }))
        .form({ post, author }),
    );

    expect(await engine.form(selected({ wanted: "priya" }))).toEqual([
      { post: "p1", author: "priya" },
    ]);

    type SelectionSource = Parameters<typeof each>[0];
    type AcceptsViewSource = ReturnType<typeof authorOf> extends SelectionSource ? true : false;
    const acceptsViewSource: AcceptsViewSource = true;
    expect(acceptsViewSource).toBe(true);
  });

  test("each captures a view that promises many rows", async () => {
    const postsBy = view("posts by (author)", ({ author }, { post }, _bindings) =>
      where(Posting._byAuthor({ author }).is({ post })),
    ).many();
    const posts = former("the posts by (author)", ({ author }, { post }) =>
      each(postsBy({ author }).is({ post })).form({ post }),
    );
    const { engine, Posting: posting } = build();
    await posting.create({ post: "p1", author: "priya" });
    await posting.create({ post: "p2", author: "priya" });
    expect(await engine.form(posts({ author: "priya" }))).toEqual([{ post: "p1" }, { post: "p2" }]);
  });
});

// ── The read-back: the engine states the quantities back ───────────────────

describe("the read-back", () => {
  test("every reaction's read-back reports opens, tests, fan-out, and drops", async () => {
    const { engine } = build();
    engine.register({
      NoteGrade: reaction(({ post, author, score, at }: Vars) =>
        when(Posting.create, {}, { post })
          .where(
            lineOf({ query: Timing._now }, {}).is({ at }),
            lineOf({ query: Posting._getPost }, { post }).is({ author }),
            whether(lineOf({ query: Grading._gradeOf }, { submission: post }).is({ score })),
            no(Posting._byAuthor({ author: "banned" })),
            is.lt(50, at),
          )
          .then(request(Recording.note, { tag: author, grade: score })),
      ),
    });
    expect(engine.readBack()).toBe(
      [
        "NoteGrade",
        "  when Posting.create — opens (post)",
        "  Timing._now () has (at) — always fills; opens (at)",
        "  Posting._getPost (post) has (author) — fills or drops the case; opens (author)",
        "  whether Grading._gradeOf (submission: post) has (score) — binds or leaves blank (score possibly blank)",
        '  no Posting._byAuthor (author: "banned") — holds only when no such row exists — drops the case otherwise',
        "  50 is less than at — tests — drops the case when it does not hold",
        "  then request Recording.note (tag: author, grade: score)",
      ].join("\n"),
    );
  });

  test("a view prints its promise beside what the body proves", () => {
    const { engine } = build();
    engine.declareViews(authorOf);
    expect(engine.readBack()).toContain(
      "the author of (post) — inputs (post); outputs (author); bindings () — promises at most one (author); the body proves it",
    );
  });
});
