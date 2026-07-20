import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Formed results evaluated when requested. These tests cover records, lists,
 * at-most-one reads, selection reductions, nested gradebook rows, consequence
 * inputs, data round trips, and rendering.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  earlier,
  faulted,
  former,
  FormerFault,
  Logging,
  opaqueCount,
  reaction,
  form,
  renderFormer,
  each,
  whether,
  Reacting,
  type Vars,
  view,
  vocabulary,
  where,
  type WhereOp,
  when,
} from "@sync-engine/internal/reactions";
import { RecorderConcept } from "../reactions/mocks.ts";

// ── Test concepts — the corpus's shapes, in miniature ─────────────────────

interface ThreadNode {
  node: string;
  conversation: string;
  parent: string | null;
  author: string;
  createdAt: number;
}

/** Conversing, in miniature: every node carries its conversation — flat reads. */
class ThreadingConcept {
  nodes: ThreadNode[] = [];
  conversations: { conversation: string; title: string }[] = [];

  start({ conversation, title }: { conversation: string; title: string }) {
    this.conversations.push({ conversation, title });
    return { conversation };
  }

  post({
    node,
    conversation,
    parent,
    author,
    createdAt,
  }: {
    node: string;
    conversation: string;
    parent: string | null;
    author: string;
    createdAt: number;
  }) {
    this.nodes.push({ node, conversation, parent, author, createdAt });
    return { node };
  }

  open({ conversation }: { conversation: string }) {
    return { conversation };
  }

  _conversations(): { conversation: string; title: string }[] {
    return [...this.conversations];
  }

  _nodes({ conversation }: { conversation: string }): ThreadNode[] {
    return this.nodes.filter((n) => n.conversation === conversation);
  }
}

/** Grading, in miniature: a flat (learner, item) cell relation. */
class GradingConcept {
  static readonly queries = { _grade: "optional" } as const;
  items: { item: string; title: string; position: number }[] = [];
  learners: { learner: string; name: string }[] = [];
  grades: { learner: string; item: string; score: number }[] = [];

  _items(): { item: string; title: string; position: number }[] {
    return [...this.items];
  }
  _learners(): { learner: string; name: string }[] {
    return [...this.learners];
  }
  _grade({ learner, item }: { learner: string; item: string }): { score: number }[] {
    return this.grades
      .filter((g) => g.learner === learner && g.item === item)
      .map(({ score }) => ({ score }));
  }
}

/** A neighbor that points back: a person carries no profile field. */
class ProfilingConcept {
  static readonly queries = { _ofOwner: "optional" } as const;
  profiles: { profile: string; owner: string; bio: string }[] = [];
  _ofOwner({ owner }: { owner: string }): { profile: string; bio: string }[] {
    return this.profiles
      .filter((p) => p.owner === owner)
      .map(({ profile, bio }) => ({ profile, bio }));
  }
}

const testVocabulary = vocabulary({
  concepts: {
    Threading: ThreadingConcept,
    Grading: { class: GradingConcept },
    Profiling: { class: ProfilingConcept },
  },
});
const ThreadingReads = testVocabulary.concepts.Threading;
const GradingReads = testVocabulary.concepts.Grading;

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    Threading: new ThreadingConcept(),
    Grading: new GradingConcept(),
    Profiling: new ProfilingConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

async function seedThread(Threading: ThreadingConcept, conversation = "c1") {
  await Threading.start({ conversation, title: "hello" });
  await Threading.post({
    node: "n1",
    conversation,
    parent: null,
    author: "priya",
    createdAt: 10,
  });
  await Threading.post({
    node: "n2",
    conversation,
    parent: "n1",
    author: "sam",
    createdAt: 20,
  });
  await Threading.post({
    node: "n3",
    conversation,
    parent: "n2",
    author: "priya",
    createdAt: 30,
  });
}

// ── Definition ─────────────────────────────────────────────────────────────

describe("formers: definition", () => {
  test("the sentence's (slot) groups are the parameters, in order", () => {
    const thread = former("thread (conversation)", ({ conversation, node, author }) =>
      form({
        conversation,
        posts: each(ThreadingReads._nodes({ conversation }).is({ node, author })).form({
          node,
          author,
        }),
      }),
    );
    expect(thread.formerName).toBe("thread (conversation)");
    expect(thread.slots).toEqual(["conversation"]);
    expect(() => thread()).toThrow("takes 1 slot value(s)");
  });

  test("a slot the body never uses is a definition error", () => {
    expect(() => former("ghost (haunt)", ({ nothing }) => form({ nothing }))).toThrow("never used");
  });

  test("a leaf bound by nothing is a definition error", () => {
    expect(() => former("dangling ()", ({ loose }) => form({ loose }))).toThrow("bound by nothing");
  });

  test("unresolved record conditions name every blocked line and binding", () => {
    expect(() =>
      former("cyclic record ()", ({ author, createdAt }) =>
        where(
          ThreadingReads._nodes({ conversation: author }).is({ createdAt }),
          ThreadingReads._nodes({ conversation: createdAt }).is({ author }),
        ).form({ author }),
      ),
    ).toThrow(
      'record conditions are unresolved — find Threading._nodes needs "author"; find Threading._nodes needs "createdAt"',
    );
  });

  test("unresolved selection conditions name every blocked line and binding", () => {
    expect(() =>
      former("cyclic selection (conversation)", ({ conversation, node, author, createdAt }) =>
        form({
          nodes: each(ThreadingReads._nodes({ conversation }).is({ node }))
            .where(
              ThreadingReads._nodes({ conversation: author }).is({ createdAt }),
              ThreadingReads._nodes({ conversation: createdAt }).is({ author }),
            )
            .form({ node }),
        }),
      ),
    ).toThrow(
      'selection conditions are unresolved — find Threading._nodes needs "author"; find Threading._nodes needs "createdAt"',
    );
  });

  test("a former answers from standing state — earlier() is rejected", () => {
    const { Threading } = setup();
    expect(() =>
      former("stale (conversation)", ({ conversation, node }) =>
        form({
          posts: each(ThreadingReads._nodes({ conversation }).is({ node }))
            .where(earlier(Threading.open, { conversation }) as unknown as WhereOp)
            .form({ node }),
        }),
      ),
    ).toThrow("standing state");
  });

  test("count cannot be used as a selection filter", () => {
    const countLike = { op: "count" } as unknown as WhereOp;
    expect(() =>
      former("misplaced (conversation)", ({ conversation, node }) =>
        form({
          posts: each(ThreadingReads._nodes({ conversation }).is({ node }))
            .where(countLike)
            .form({ node }),
        }),
      ),
    ).toThrow("End the selection with .count()");
  });
});

// ── Evaluation: the board — form, comprehension, arranged ───────────────

describe("formers: evaluation", () => {
  test("forms a record whose key contains an ordered list", async () => {
    const { reacting, Threading } = setup();
    await seedThread(Threading);
    const thread = former("thread (conversation)", ({ conversation, node, author, createdAt }) =>
      form({
        conversation,
        posts: each(ThreadingReads._nodes({ conversation }).is({ node, author, createdAt }))
          .arranged("oldest")
          .form({ node, author }),
      }),
    );
    expect(await reacting.form(thread("c1"))).toEqual({
      conversation: "c1",
      posts: [
        { node: "n1", author: "priya" },
        { node: "n2", author: "sam" },
        { node: "n3", author: "priya" },
      ],
    });
  });

  test("arranged by a bound value, descending", async () => {
    const { reacting, Threading } = setup();
    await seedThread(Threading);
    const latestFirst = former("latest first (conversation)", ({ conversation, node, createdAt }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, createdAt }))
        .arranged(createdAt, "descending")
        .form({ node }),
    );
    expect(await reacting.form(latestFirst("c1"))).toEqual([
      { node: "n3" },
      { node: "n2" },
      { node: "n1" },
    ]);
  });

  test("a selection's where keeps only what matches", async () => {
    const { reacting, Threading } = setup();
    await seedThread(Threading);
    const byPriya = former(
      "posts by (author) in (conversation)",
      ({ conversation, author, node }) =>
        each(ThreadingReads._nodes({ conversation }).is({ node, author })).form({ node }),
    );
    // The already-bound `author` slot unifies against each row — an equality
    // test per match, the same discipline as everywhere else.
    expect(await reacting.form(byPriya("priya", "c1"))).toEqual([{ node: "n1" }, { node: "n3" }]);
  });
});

// ── At-most-one query reads ────────────────────────────────────────────────

describe("formers: records from at-most-one queries", () => {
  const profileCard = (Profiling: ProfilingConcept) =>
    former("profile card (person)", ({ person, profile, bio }) =>
      where(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })).form({
        person,
        profile,
        bio,
      }),
    );

  test("a matching query row binds fields into the record", async () => {
    const { reacting, Profiling } = setup();
    Profiling.profiles.push({ profile: "p1", owner: "priya", bio: "designs" });
    expect(await reacting.form(profileCard(Profiling)("priya"))).toEqual({
      person: "priya",
      profile: "p1",
      bio: "designs",
    });
  });

  test("a required single-value read faults when no row exists", async () => {
    const { reacting, Profiling } = setup();
    await expect(reacting.form(profileCard(Profiling)("nobody"))).rejects.toThrow(FormerFault);
    await expect(reacting.form(profileCard(Profiling)("nobody"))).rejects.toThrow("FORMER_NONE");
  });

  test("a single-value read faults on several rows in both forms", async () => {
    const { reacting, Profiling } = setup();
    Profiling.profiles.push(
      { profile: "p1", owner: "priya", bio: "one" },
      { profile: "p2", owner: "priya", bio: "two" },
    );
    await expect(reacting.form(profileCard(Profiling)("priya"))).rejects.toThrow(
      'promises "optional"',
    );
    const optionalCard = former("optional card (person)", ({ person, profile, bio }) =>
      where(
        whether(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })),
      ).form({
        person,
        profile,
      }),
    );
    await expect(reacting.form(optionalCard("priya"))).rejects.toThrow('promises "optional"');
  });

  test("whether assigns null to fields when the query returns no row", async () => {
    const { reacting, Profiling } = setup();
    const card = former("card (person)", ({ person, profile, bio }) =>
      where(
        whether(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })),
      ).form({
        person,
        profile,
        bio,
      }),
    );
    expect(await reacting.form(card("nobody"))).toEqual({
      person: "nobody",
      profile: null,
      bio: null,
    });
  });

  test("absence propagates: a read through an unbound name is nothing, never a fault", async () => {
    const { reacting, Profiling } = setup();
    // No profile exists for "nobody", so `profile` remains unset. The second
    // query therefore returns no row, and `whether` keeps the record.
    const chained = former("chained (person)", ({ person, profile, bio }) =>
      where(
        whether(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })),
        whether(lineOf({ query: Profiling._ofOwner }, { owner: profile }).is({})),
      ).form({ person, profile }),
    );
    expect(await reacting.form(chained("nobody"))).toEqual({ person: "nobody", profile: null });
  });
});

// ── Selection reductions in a feed row ────────────────────────────────────

describe("formers: selection reductions", () => {
  const feedRow = () =>
    former("feed row (conversation)", ({ conversation, node, parent, author, createdAt }) =>
      form({
        conversation,
        replyCount: each(
          ThreadingReads._nodes({ conversation }).is({ node, parent }).is.not({ parent: null }),
        ).count(),
        lastActivity: each(ThreadingReads._nodes({ conversation }).is({ node, createdAt }))
          .arranged(createdAt, "descending")
          .first(createdAt),
        participants: each(ThreadingReads._nodes({ conversation }).is({ node, author })).distinct(
          author,
        ),
      }),
    );

  test("count / first-arranged / distinct, taken at the moment of asking", async () => {
    const { reacting, Threading } = setup();
    await seedThread(Threading);
    expect(await reacting.form(feedRow()("c1"))).toEqual({
      conversation: "c1",
      replyCount: 2, // the replies are the nodes with a parent — no `− 1` arithmetic
      lastActivity: 30,
      participants: ["priya", "sam"], // distinct, first-seen order
    });
  });

  test("an empty selection: count 0, first null, distinct []", async () => {
    const { reacting, Threading } = setup();
    await Threading.start({ conversation: "empty", title: "quiet" });
    expect(await reacting.form(feedRow()("empty"))).toEqual({
      conversation: "empty",
      replyCount: 0,
      lastActivity: null,
      participants: [],
    });
  });

  test("the whole feed: aggregates per row of an enclosing comprehension", async () => {
    const { reacting, Threading } = setup();
    await seedThread(Threading, "c1");
    await Threading.start({ conversation: "c2", title: "second" });
    await Threading.post({
      node: "m1",
      conversation: "c2",
      parent: null,
      author: "ada",
      createdAt: 99,
    });
    const feed = former("the feed ()", ({ conversation, title, node, parent, author }) =>
      each(ThreadingReads._conversations({}).is({ conversation, title })).form({
        conversation,
        title,
        replyCount: each(
          ThreadingReads._nodes({ conversation }).is({ node, parent }).is.not({ parent: null }),
        ).count(),
        participants: each(ThreadingReads._nodes({ conversation }).is({ node, author })).distinct(
          author,
        ),
      }),
    );
    expect(await reacting.form(feed())).toEqual([
      { conversation: "c1", title: "hello", replyCount: 2, participants: ["priya", "sam"] },
      { conversation: "c2", title: "second", replyCount: 0, participants: ["ada"] },
    ]);
  });
});

// ── The gradebook matrix: nested lists and an optional read ────────────────

describe("formers: the gradebook matrix", () => {
  test("items × learners, cells none-or-one — no new former kind needed", async () => {
    const { reacting, Grading } = setup();
    Grading.items.push(
      { item: "hw2", title: "Homework 2", position: 2 },
      { item: "hw1", title: "Homework 1", position: 1 },
    );
    Grading.learners.push({ learner: "sam", name: "Sam" }, { learner: "ada", name: "Ada" });
    Grading.grades.push({ learner: "sam", item: "hw1", score: 88 });

    const gradebook = former("gradebook ()", ({ item, title, position, learner, name, score }) =>
      form({
        items: each(GradingReads._items({}).is({ item, title, position }))
          .arranged(position)
          .form({ item, title }),
        rows: each(GradingReads._learners({}).is({ learner, name })).form({
          learner,
          name,
          cells: each(GradingReads._items({}).is({ item, position }))
            .where(whether(lineOf({ query: Grading._grade }, { learner, item }).is({ score })))
            .arranged(position)
            .form({ item, score }),
        }),
      }),
    );

    expect(await reacting.form(gradebook())).toEqual({
      items: [
        { item: "hw1", title: "Homework 1" },
        { item: "hw2", title: "Homework 2" },
      ],
      rows: [
        {
          learner: "sam",
          name: "Sam",
          cells: [
            { item: "hw1", score: 88 },
            { item: "hw2", score: null },
          ],
        },
        {
          learner: "ada",
          name: "Ada",
          cells: [
            { item: "hw1", score: null },
            { item: "hw2", score: null },
          ],
        },
      ],
    });
  });
});

// ── Dispatch: a then input evaluates a former into the action ask ─────────

describe("formers: dispatch integration", () => {
  test("a reaction responds with a former's tree, evaluated per firing", async () => {
    const { reacting, Threading, Recorder } = setup();
    const summary = former("summary (conversation)", ({ conversation, node, parent }) =>
      form({
        conversation,
        replyCount: each(
          ThreadingReads._nodes({ conversation }).is({ node, parent }).is.not({ parent: null }),
        ).count(),
      }),
    );
    reacting.register({
      ServeThread: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Recorder.record, { tag: summary(conversation) }),
        ),
      ),
    });
    await seedThread(Threading);
    await Threading.open({ conversation: "c1" });
    expect(Recorder.order).toEqual([{ conversation: "c1", replyCount: 2 }]);
  });

  test("a former fault prevents the consequence action from running", async () => {
    const { reacting, Profiling, Threading, Recorder } = setup();
    const card = former("card (person)", ({ person, profile, bio }) =>
      where(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })).form({
        person,
        bio,
      }),
    );
    reacting.register({
      ServeCard: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Recorder.record, { tag: card("nobody") }),
        ),
      ),
    });
    await Threading.open({ conversation: "c1" });
    expect(Recorder.order).toEqual([]);
  });

  test("a fault channel matches a forming fault's raw input without retaining it", async () => {
    const { reacting, Profiling, Threading } = setup();
    let observedSetupKey: unknown;
    class ProtectedAction {
      run(_: { setupKey: unknown }) {
        throw new Error("the forming fault should prevent this action");
      }
    }
    class FaultRecorder {
      record({ setupKey }: { setupKey: unknown }) {
        observedSetupKey = setupKey;
        return {};
      }
    }
    const Protected = reacting.instrumentConcept(new ProtectedAction(), "Protected");
    const Recorded = reacting.instrumentConcept(new FaultRecorder(), "FaultRecorder");
    const card = former("protected card (person)", ({ person, profile, bio }) =>
      where(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })).form({
        person,
        bio,
      }),
    );
    reacting.register({
      FormProtectedInput: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Protected.run, { setupKey: card("setup-key-sentinel") }),
        ),
      ),
      ObserveFormingFault: reaction(({ input }: Vars) =>
        when(faulted({ input })).then(request(Recorded.record, { setupKey: input })),
      ),
    });

    await Threading.open({ conversation: "c1" });

    expect(JSON.stringify(observedSetupKey)).toContain("setup-key-sentinel");
    const retained = [...reacting.Action.actions.values()];
    expect(
      retained.find((record) => record.concept.constructor.name === "ProtectedAction")?.input,
    ).toEqual({ setupKey: "[redacted]" });
    expect(JSON.stringify(retained)).not.toContain("setup-key-sentinel");
    expect(reacting.Action._getMatchingRecordCount()).toBe(0);
  });
});

// ── IR: export, round-trip, registration ───────────────────────────────────

describe("formers: IR round-trip", () => {
  function boardApp() {
    const { reacting, Threading, Grading, Profiling, Recorder } = setup();
    const summary = former("summary (conversation)", ({ conversation, node, author, createdAt }) =>
      form({
        conversation,
        posts: each(ThreadingReads._nodes({ conversation }).is({ node, author, createdAt }))
          .arranged(createdAt)
          .form({ node, author }),
        participants: each(ThreadingReads._nodes({ conversation }).is({ node, author })).distinct(
          author,
        ),
      }),
    );
    reacting.register({
      ServeThread: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Recorder.record, { tag: summary(conversation) }),
        ),
      ),
    });
    return { reacting, Threading, Grading, Profiling, Recorder };
  }

  test("a then input's former exports as a $former reference plus a formers entry", () => {
    const { reacting } = boardApp();
    const app = reacting.exportReactions();
    expect(app.formers.map((f) => f.name)).toEqual(["summary (conversation)"]);
    const consequence = app.reactions[0].then[0];
    expect(JSON.stringify(consequence.input)).toContain('"$former"');
    expect(opaqueCount(app)).toBe(0);
  });

  test("export ∘ register is a fixed point, and behavior carries over", async () => {
    const first = boardApp();
    const exported = first.reacting.exportReactions();

    const second = setup();
    second.reacting.registerFormers(exported.formers);
    second.reacting.registerReactions(exported.reactions);
    const reexported = second.reacting.exportReactions();
    expect(JSON.stringify(reexported.formers)).toBe(JSON.stringify(exported.formers));
    expect(JSON.stringify(reexported.reactions)).toBe(JSON.stringify(exported.reactions));

    await seedThread(second.Threading);
    await second.Threading.open({ conversation: "c1" });
    expect(second.Recorder.order).toEqual([
      {
        conversation: "c1",
        posts: [
          { node: "n1", author: "priya" },
          { node: "n2", author: "sam" },
          { node: "n3", author: "priya" },
        ],
        participants: ["priya", "sam"],
      },
    ]);
  });

  test("imported former IR rejects names used before they are bound", () => {
    const second = setup();
    expect(() =>
      second.reacting.registerFormers([
        {
          name: "broken (conversation)",
          promise: "one",
          body: {
            node: "each",
            from: {
              op: "find",
              query: { concept: "Threading", query: "_nodes" },
              in: { conversation: { $var: "missing" } },
              out: { node: { $var: "node" } },
            },
            as: { node: "record", entries: { node: { node: "leaf", var: "node" } } },
          },
        },
      ]),
    ).toThrow('each(...) input uses "missing" before it is bound');
  });

  test("reactions referencing an unregistered former fail loudly", () => {
    const first = boardApp();
    const exported = first.reacting.exportReactions();
    const second = setup();
    expect(() => second.reacting.registerReactions(exported.reactions)).toThrow("not registered");
  });

  test("two different definitions of one sentence are rejected", () => {
    const { reacting, Threading, Recorder } = setup();
    const one = former("the same (conversation)", ({ conversation, node }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node })).form({ node }),
    );
    const two = former("the same (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author })).form({ author }),
    );
    const declare = (name: string, ref: typeof one) =>
      reacting.register({
        [name]: reaction(({ conversation }: Vars) =>
          when(Threading.open, { conversation }).then(
            request(Recorder.record, { tag: ref(conversation) }),
          ),
        ),
      });
    declare("First", one);
    expect(reacting.exportReactions().formers).toHaveLength(1);
    expect(() => declare("Second", two)).toThrow("different definition");
  });

  test("a view inside a former's selection exports with the app's views", async () => {
    const { reacting, Threading, Recorder } = setup();
    const isReply = view("(node) is a reply in (conversation)", ({ node, conversation }) =>
      where(ThreadingReads._nodes({ conversation }).is({ node }).is.not({ parent: null })),
    );
    const replies = former("replies (conversation)", ({ conversation, node }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node }))
        .where(isReply({ node, conversation }))
        .form({ node }),
    );
    reacting.declareFormers(replies);
    const app = reacting.exportReactions();
    expect(app.views.map((v) => v.name)).toEqual(["(node) is a reply in (conversation)"]);
    expect(app.formers.map((f) => f.name)).toEqual(["replies (conversation)"]);
    await seedThread(Threading);
    expect(await reacting.form(replies("c1"))).toEqual([{ node: "n2" }, { node: "n3" }]);
    expect(Recorder.order).toEqual([]);
  });
});

// ── Rendering ──────────────────────────────────────────────────────────────

describe("formers: rendering", () => {
  test("a former renders as a former block", () => {
    const { reacting, Profiling } = setup();
    const summary = former(
      "summary (conversation)",
      ({ conversation, node, parent, author, createdAt, profile, bio }) =>
        where(
          whether(
            lineOf({ query: Profiling._ofOwner }, { owner: conversation }).is({ profile, bio }),
          ),
        ).form({
          conversation,
          bio,
          replyCount: each(
            ThreadingReads._nodes({ conversation }).is({ node, parent }).is.not({ parent: null }),
          ).count(),
          lastActivity: each(ThreadingReads._nodes({ conversation }).is({ node, createdAt }))
            .arranged(createdAt, "descending")
            .first(createdAt),
          posts: each(ThreadingReads._nodes({ conversation }).is({ node, author }))
            .arranged("oldest")
            .form({ node, author }),
        }),
    );
    reacting.declareFormers(summary);
    const rendered = renderFormer(reacting.exportReactions().formers[0]);
    expect(rendered).toBe(
      [
        "Form summary (conversation) as follows:",
        "  a record of",
        "    where whether Profiling._ofOwner (owner: conversation) has (profile, bio)",
        "    conversation",
        "    bio",
        "    replyCount: the count of Threading._nodes (conversation) has (node, parent) and not (parent: null)",
        "    lastActivity: the createdAt of the first Threading._nodes (conversation) has (node, createdAt)",
        "      arranged by createdAt, descending",
        "    posts: each Threading._nodes (conversation) has (node, author)",
        "      arranged oldest",
        "      form a record of",
        "        node",
        "        author",
      ].join("\n"),
    );
  });

  test("the app spec carries a Formers section, and the consequence reads as the sentence", () => {
    const { reacting, Threading, Recorder } = setup();
    const summary = former("summary (conversation)", ({ conversation, node }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node })).form({ node }),
    );
    reacting.register({
      ServeThread: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Recorder.record, { tag: summary(conversation) }),
        ),
      ),
    });
    const spec = reacting.renderApp("Formers demo");
    expect(spec).toContain("## Formers");
    expect(spec).toContain("```former\nForm summary (conversation) as follows:");
    expect(spec).toContain("request Recorder.record (tag: summary (conversation))");
  });
});

// ── Fragments: formers with open bindings, spliced at use sites ───────────

describe("formers: fragments (splice)", () => {
  /** A reusable optional profile fragment merged into post rows. */
  function postSummaryFragment(Profiling: ProfilingConcept) {
    return former("the profile summary of (person), if any", ({ person, profile, bio }) =>
      where(lineOf({ query: Profiling._ofOwner }, { owner: person }).is({ profile, bio })).form({
        profile,
        bio,
      }),
    );
  }

  test("a splice closes the fragment's anchors and merges its keys flat", async () => {
    const { reacting, Threading, Profiling } = setup();
    Profiling.profiles.push({ profile: "p1", owner: "priya", bio: "designs" });
    await seedThread(Threading);
    const summary = postSummaryFragment(Profiling);
    const posts = former("the posts of (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author }))
        .form({ node, author })
        .splicing(whether(summary(author))),
    );
    const tree = (await reacting.form(posts("c1"))) as Array<Record<string, unknown>>;
    expect(tree).toHaveLength(3);
    expect(tree[0]).toEqual({ node: "n1", author: "priya", profile: "p1", bio: "designs" });
    // sam has no profile: the default posture reads the fragment's leaves null.
    expect(tree[1]).toEqual({ node: "n2", author: "sam", profile: null, bio: null });
  });

  test("a named former nests at a key; whether forms blanks and plain drops", async () => {
    const { reacting, Profiling } = setup();
    Profiling.profiles.push({ profile: "p1", owner: "priya", bio: "designs" });
    const summary = postSummaryFragment(Profiling);
    const nested = former("the nested profile of (person)", ({ person }) =>
      form({ person, summary: whether(summary(person)) }),
    );
    const present = former("the present nested profile of (person), if any", ({ person }) =>
      form({ person, summary: summary(person) }),
    );
    expect(await reacting.form(nested("sam"))).toEqual({
      person: "sam",
      summary: { profile: null, bio: null },
    });
    expect(await reacting.form(present("sam"))).toBeNull();
    expect(await reacting.form(present("priya"))).toEqual({
      person: "priya",
      summary: { profile: "p1", bio: "designs" },
    });
  });

  test("plain splice use vanishes the host's row", async () => {
    const { reacting, Threading, Profiling } = setup();
    Profiling.profiles.push({ profile: "p1", owner: "priya", bio: "designs" });
    await seedThread(Threading);
    const summary = postSummaryFragment(Profiling);
    const posts = former("the profiled posts of (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author }))
        .form({ node })
        .splicing(summary(author)),
    );
    const tree = (await reacting.form(posts("c1"))) as Array<Record<string, unknown>>;
    // Only priya's two posts survive; sam's row vanished.
    expect(tree.map((row) => row.node)).toEqual(["n1", "n3"]);
  });

  test("a splice anchor bound by nothing is a definition error", () => {
    const { Profiling } = setup();
    const summary = postSummaryFragment(Profiling);
    expect(() =>
      former("the floating summary (conversation)", ({ conversation, node, person }) =>
        each(ThreadingReads._nodes({ conversation }).is({ node }))
          .form({ node })
          .splicing(whether(summary(person))),
      ),
    ).toThrow("bound by nothing");
  });

  test("several fragment rows fault for either splice posture", async () => {
    const { reacting, Threading, Profiling } = setup();
    Profiling.profiles.push(
      { profile: "p1", owner: "priya", bio: "one" },
      { profile: "p2", owner: "priya", bio: "two" },
    );
    await seedThread(Threading);
    const summary = postSummaryFragment(Profiling);
    const posts = former("the posts of (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author }))
        .form({ node })
        .splicing(whether(summary(author))),
    );
    await expect(reacting.form(posts("c1"))).rejects.toThrow('promises "optional"');
  });

  test("splice key collisions are definition-time errors; only record roots splice", () => {
    const { Profiling } = setup();
    const summary = postSummaryFragment(Profiling);
    expect(() =>
      former("colliding (conversation)", ({ conversation, node, author }) =>
        each(ThreadingReads._nodes({ conversation }).is({ node, author }))
          .form({ node, bio: author as never })
          .splicing(whether(summary(author))),
      ),
    ).toThrow('collides on key "bio"');
    const listShaped = former("the nodes of (conversation)", ({ conversation, node }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node })).form({ node }),
    );
    expect(() => form({}).splicing(listShaped("c1"))).toThrow("not record-rooted");
  });

  test("the IR retains fragments through dependency-first export and round-trip", () => {
    const { reacting, Threading, Profiling, Recorder } = setup();
    const summary = postSummaryFragment(Profiling);
    const posts = former("the posts of (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author }))
        .form({ node, author })
        .splicing(summary(author)),
    );
    reacting.register({
      Serve: reaction(({ conversation }: Vars) =>
        when(Threading.open, { conversation }).then(
          request(Recorder.record, { tag: posts(conversation) }),
        ),
      ),
    });
    const app = reacting.exportReactions();
    const names = app.formers.map((f) => f.name);
    // The fragment exports before its host.
    expect(names.indexOf("the profile summary of (person), if any")).toBeLessThan(
      names.indexOf("the posts of (conversation)"),
    );

    // Round-trip: register into a second engine, dependencies first, and re-export.
    const second = setup();
    second.reacting.instrument({});
    second.reacting.registerFormers(app.formers);
    expect(JSON.stringify(second.reacting.exportReactions().formers.slice(0, 2))).toBe(
      JSON.stringify(app.formers.slice(0, 2)),
    );
  });

  test("a splice renders as the … line, posture said when it drops", () => {
    const { reacting, Profiling } = setup();
    const summary = postSummaryFragment(Profiling);
    const posts = former("the posts of (conversation)", ({ conversation, node, author }) =>
      each(ThreadingReads._nodes({ conversation }).is({ node, author }))
        .form({ node })
        .splicing(summary(author)),
    );
    reacting.declareFormers(posts);
    const hostIR = reacting
      .exportReactions()
      .formers.find((f) => f.name === "the posts of (conversation)");
    const rendered = renderFormer(hostIR as never);
    expect(rendered).toContain("… the profile summary of (person: author)");
  });
});
