import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { defineInterface } from "@mit-sdg/sync-engine/boundary";
import { context, each, renderer } from "@mit-sdg/sync-engine-rendering/language";
import { expect, test } from "vite-plus/test";
import { realize } from "../src/realization/index.ts";

class NoteTextRequired extends Error {}

class NotingConcept {
  readonly #byBoard = new Map<string, Array<{ note: string; text: string }>>();
  #fresh = 0;

  note({ board, text }: { board: string; text: string }): { note: string } {
    if (text.trim().length === 0) {
      throw new NoteTextRequired("A note needs nonblank text.");
    }
    const note = `n-${(this.#fresh += 1)}`;
    const history = this.#byBoard.get(board);
    if (history === undefined) this.#byBoard.set(board, [{ note, text }]);
    else history.push({ note, text });
    return { note };
  }

  _on({ board }: { board: string }): Array<{ note: string; text: string }> {
    return (this.#byBoard.get(board) ?? []).map((record) => ({ ...record }));
  }
}

const spec = `# Noting

## Purpose

Keep an ordered record of notes on each board so a later reader sees what was
recorded and in what order.

## Principle

On board \`alpha\`, note \`first\` is recorded and then note \`second\`.
\`_on(alpha)\` returns \`first\` followed by \`second\`. Recording a blank note
is refused.

## Types

\`\`\`types
external Board
  The board on which notes are recorded.
\`\`\`

## State

\`\`\`state
an ordered set of Notes with
  a board Board
  a text Text

Rule: each Note's position is the order in which its accepted Action added it within that Board
\`\`\`

## Actions

\`\`\`actions
note (board: Board, text: Text) : return (note: Note)
  where text is blank
  then
    refuse NOTE_TEXT_REQUIRED "A note needs nonblank text."
  where text is nonblank
  then
    add a new Note with the board and text after the board's existing Notes
    return note
\`\`\`

## Queries

\`\`\`queries
_on (board: Board) : many identified by (note) (note: Note, text: Text)
  Returns the board's Notes in recorded order.
\`\`\`
`;

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function installBoard() {
  const noting = registerConcept({
    class: NotingConcept,
    spec,
    refusals: { NOTE_TEXT_REQUIRED: NoteTextRequired },
  });
  const applicationConceptSet = conceptSet({ Noting: noting });
  const { Noting } = applicationConceptSet.concepts;
  const Board = renderer(
    "Projects one board and its recording ask.",
    ({ board }, { note, text }, { entry }) => context`
      ## Notes on ${board}

      ${each(Noting._on({ board }).is({ note, text })).context`
        - ${text}
      `}
      ${Noting.note({ board, text: entry })}
    `,
  );
  const Reasoner = defineInterface({ Board });
  const system = assemble({
    conceptSet: applicationConceptSet,
    composition: {},
    interfaces: { Board, Reasoner },
  });
  return { Board, Reasoner, system };
}

test("opens one unit, submits an ask ordinarily, and reforms on settlement", async () => {
  const { Board, Reasoner, system } = installBoard();
  const realization = realize({ system, interface: Reasoner });
  const unit = await realization.open(Board({ board: "alpha" }));

  expect(unit.holder).toBe('Board({"board":"alpha"})');
  const opening = unit.formed();
  expect(opening.text).toContain("## Notes on alpha");
  expect(opening.asks).toHaveLength(1);

  const revisions: string[] = [];
  unit.reformed((formed) => revisions.push(formed.revision));

  const answer = await unit.submit(opening.asks[0].id, { entry: "first" });
  expect(answer.ok).toBe(true);
  await system.whenIdle();
  await eventually(() => revisions.length === 1);
  expect(revisions).toHaveLength(1);
  expect(unit.formed().text).toContain("- first\n");
  expect(unit.formed().revision).not.toBe(opening.revision);

  realization.close();
});

test("a concept refusal answers the ask and changes nothing", async () => {
  const { Board, Reasoner, system } = installBoard();
  const realization = realize({ system, interface: Reasoner });
  const unit = await realization.open(Board({ board: "alpha" }));
  const opening = unit.formed();
  const notified: string[] = [];
  unit.reformed((formed) => notified.push(formed.revision));

  const refused = await unit.submit(opening.asks[0].id, { entry: "   " });
  expect(refused.ok).toBe(false);
  if (!refused.ok) {
    expect(refused.refusal.error).toBe("NOTE_TEXT_REQUIRED");
  }
  await system.whenIdle();
  expect(notified).toHaveLength(0);
  expect(unit.formed().revision).toBe(opening.revision);

  realization.close();
});

test("an unknown ask or blank mapping is an INVALID_ASK answer", async () => {
  const { Board, Reasoner, system } = installBoard();
  const realization = realize({ system, interface: Reasoner });
  const unit = await realization.open(Board({ board: "alpha" }));
  const opening = unit.formed();

  const unknown = await unit.submit("root/nowhere/ask", {});
  expect(unknown).toMatchObject({ ok: false, refusal: { error: "INVALID_ASK" } });
  const misnamed = await unit.submit(opening.asks[0].id, { wrong: "x" });
  expect(misnamed).toMatchObject({ ok: false, refusal: { error: "INVALID_ASK" } });

  realization.close();
});

test("an unaffected unit neither reforms nor leaks another unit's change", async () => {
  const { Board, Reasoner, system } = installBoard();
  const realization = realize({ system, interface: Reasoner });
  const alpha = await realization.open(Board({ board: "alpha" }));
  const beta = await realization.open(Board({ board: "beta" }));
  const alphaRevisions: string[] = [];
  const betaRevisions: string[] = [];
  alpha.reformed((formed) => alphaRevisions.push(formed.revision));
  beta.reformed((formed) => betaRevisions.push(formed.revision));

  await alpha.submit(alpha.formed().asks[0].id, { entry: "only alpha" });
  await system.whenIdle();
  await eventually(() => alphaRevisions.length === 1);

  expect(alphaRevisions).toHaveLength(1);
  expect(betaRevisions).toHaveLength(0);
  expect(beta.formed().text).not.toContain("only alpha");

  realization.close();
});

test("closing a unit stops its notifications", async () => {
  const { Board, Reasoner, system } = installBoard();
  const realization = realize({ system, interface: Reasoner });
  const unit = await realization.open(Board({ board: "alpha" }));
  const survivor = await realization.open(Board({ board: "alpha" }));
  const closedRevisions: string[] = [];
  const survivorRevisions: string[] = [];
  unit.reformed((formed) => closedRevisions.push(formed.revision));
  survivor.reformed((formed) => survivorRevisions.push(formed.revision));
  unit.close();

  await survivor.submit(survivor.formed().asks[0].id, { entry: "after close" });
  await system.whenIdle();
  await eventually(() => survivorRevisions.length === 1);

  expect(closedRevisions).toHaveLength(0);
  expect(survivorRevisions).toHaveLength(1);
  realization.close();
});
