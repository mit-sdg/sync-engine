import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Static concept refs: authoring against names, resolved per engine.
 *
 * The load-bearing property is the last describe block: a reaction, view, or
 * former authored at module level against a vocabulary is a shared template,
 * and two engines in one process must each resolve it against their own
 * instances — resolution materializes per-engine copies and never mutates
 * the shared declaration.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  former,
  isActionRef,
  isQueryRef,
  isReaction,
  reaction,
  each,
  whether,
  Reacting,
  view,
  where,
  vocabulary,
  when,
} from "@sync-engine/internal/reactions";

class NotingConcept {
  static readonly queries = { _getNote: "optional", _all: "many" } as const;
  notes = new Map<string, string>();
  add({ id, text }: { id: string; text: string }) {
    this.notes.set(id, text);
    return { note: id };
  }
  _getNote({ note }: { note: string }) {
    const text = this.notes.get(note as string);
    return text === undefined ? [] : [{ text }];
  }
  _all(_: Record<string, never>) {
    return [...this.notes.entries()].map(([note, text]) => ({ note, text }));
  }
}

class EchoingConcept {
  heard: string[] = [];
  hear({ text }: { text: string }) {
    this.heard.push(text as string);
    return {};
  }
}

const { Noting, Echoing } = vocabulary({
  concepts: { Noting: { class: NotingConcept }, Echoing: EchoingConcept },
  computations: {},
}).concepts;

describe("vocabulary refs", () => {
  test("members are named refs, queries carrying queryName", () => {
    expect(isActionRef(Noting.add)).toBe(true);
    expect(isQueryRef(Noting._getNote)).toBe(true);
    expect((Noting.add as { refConcept?: string }).refConcept).toBe("Noting");
    expect((Noting._getNote as { queryName?: string }).queryName).toBe("_getNote");
  });

  test("calling an action ref authors a requested action line", () => {
    const line = Noting.add({ id: "n", text: "note" });
    expect(line.action.action).toBe(Noting.add);
    expect(line.action.input).toEqual({ id: "n", text: "note" });
    expect(line.linePosture).toBe("requested");
  });

  test("a member the class does not declare is an error at access", () => {
    expect(() => (Noting as unknown as Record<string, unknown>).addd).toThrow(
      /"Noting\.addd" is not an action or query/,
    );
  });

  test("reaction(...) brands the reaction function", () => {
    const taggedReaction = reaction(({ note }) =>
      when(Noting.add, {}, { note }).then(request(Echoing.hear, { text: "x" })),
    );
    expect(isReaction(taggedReaction)).toBe(true);
    expect(isReaction(() => undefined)).toBe(false);
  });
});

// ── Module-level templates, shared by every engine below ──────────────────

const readsAs = view("(note) reads as (text)", ({ note, text }, _outputs, _bindings) =>
  where(lineOf({ query: Noting._getNote }, { note }).is({ text })),
).holds();

const theNotes = former("the notes ()", (_inputs, { note, text }) =>
  each(lineOf({ query: Noting._all }, {}).is({ note, text })).form({ note, text }),
);

const theNoteCard = former("the note card of (note)", ({ note }, { text }) =>
  where(whether(lineOf({ query: Noting._getNote }, { note }).is({ text }))).form({ text }),
).optional();

const theShelf = former("the shelf ()", (_inputs, { note, text }) =>
  each(lineOf({ query: Noting._all }, {}).is({ note, text: text }))
    .form({ note })
    .splicing(whether(theNoteCard({ note }))),
);

const EchoNote = reaction(({ note, text }) =>
  when(Noting.add, {}, { note })
    .where(lineOf({ query: Noting._getNote }, { note }).is({ text }), readsAs({ note, text }))
    .then(request(Echoing.hear, { text })),
);

function build() {
  const engine = new Reacting();
  const concepts = {
    Noting: engine.instrumentConcept(new NotingConcept(), "Noting"),
    Echoing: engine.instrumentConcept(new EchoingConcept(), "Echoing"),
  };
  engine.register({ EchoNote });
  return { engine, concepts };
}

describe("per-engine resolution of shared templates", () => {
  test("a reaction against refs fires through its own engine's instances", async () => {
    const { concepts } = build();
    await concepts.Noting.add({ id: "a", text: "alpha" });
    expect(concepts.Echoing.heard).toEqual(["alpha"]);
  });

  test("two engines resolve one module-level template to their own concepts", async () => {
    const a = build();
    const b = build();
    await a.concepts.Noting.add({ id: "a1", text: "alpha" });
    await b.concepts.Noting.add({ id: "b1", text: "beta" });

    expect(a.concepts.Echoing.heard).toEqual(["alpha"]);
    expect(b.concepts.Echoing.heard).toEqual(["beta"]);

    expect(await a.engine.form(theNotes({}))).toEqual([{ note: "a1", text: "alpha" }]);
    expect(await b.engine.form(theNotes({}))).toEqual([{ note: "b1", text: "beta" }]);
  });

  test("a spliced fragment resolves with its host, per engine", async () => {
    const a = build();
    await a.concepts.Noting.add({ id: "a1", text: "alpha" });
    expect(await a.engine.form(theShelf({}))).toEqual([{ note: "a1", text: "alpha" }]);
  });

  test("the rendered spec carries the resolved view and former by name", async () => {
    const { engine } = build();
    engine.declareFormers(theNotes, theShelf);
    const spec = engine.renderApp("refs");
    expect(spec).toContain("(note) reads as (text)");
    expect(spec).toContain("the notes ()");
    expect(spec).toContain("the note card of (note)");
  });

  test("an unknown concept name fails loudly at registration", () => {
    const engine = new Reacting();
    engine.instrumentConcept(new EchoingConcept(), "Echoing");
    expect(() => engine.register({ EchoNote })).toThrow(
      /no instrumented concept is named "Noting"/,
    );
  });
});
