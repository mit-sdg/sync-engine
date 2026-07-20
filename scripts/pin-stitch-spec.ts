import { writeFile } from "node:fs/promises";
import { Logging, Reacting } from "../src/internal/reactions/index.ts";
import { FocusConcept, HistoryConcept, WorkConcept } from "../tests/golden/stitch/concepts.ts";
import { makeStitchFormers, makeStitchReactions } from "../tests/golden/stitch/reactions.ts";

const engine = new Reacting();
engine.logging = Logging.OFF;
const { Work, Focus, History } = engine.instrument({
  Work: new WorkConcept({ nextId: 1, items: [] }),
  Focus: new FocusConcept({ current: null, sessions: [] }),
  History: new HistoryConcept({ entries: [] }),
});
engine.register(makeStitchReactions(Work, Focus, History));
engine.declareFormers(...Object.values(makeStitchFormers(Work, Focus, History)));

await writeFile(
  new URL("../tests/golden/stitch/golden/spec.md", import.meta.url),
  engine.renderApp("Stitch"),
);
