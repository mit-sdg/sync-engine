import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLogSink, assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { afterEach, describe, expect, test } from "vite-plus/test";

type Note = { note: string; text: string };

class FileBackedNotes {
  static readonly queries = { _all: "many" } as const;
  private notes: Note[];

  constructor(private readonly statePath: string) {
    this.notes = fs.existsSync(statePath)
      ? (JSON.parse(fs.readFileSync(statePath, "utf8")) as Note[])
      : [];
  }

  save({ note, text }: Note): Note {
    this.notes = [...this.notes.filter((entry) => entry.note !== note), { note, text }];
    fs.writeFileSync(this.statePath, `${JSON.stringify(this.notes)}\n`);
    return { note, text };
  }

  _all(_: Record<string, never>): Note[] {
    return this.notes.map((entry) => ({ ...entry }));
  }
}

class SearchIndexConcept {
  static readonly queries = { _all: "many" } as const;
  private notes: Note[] = [];

  index({ note, text }: Note): Record<string, never> {
    this.notes = [...this.notes.filter((entry) => entry.note !== note), { note, text }];
    return {};
  }

  _all(_: Record<string, never>): Note[] {
    return this.notes.map((entry) => ({ ...entry }));
  }
}

const notebookVocabulary = vocabulary({
  concepts: { Notes: FileBackedNotes, SearchIndex: SearchIndexConcept },
});
const { Notes, SearchIndex } = notebookVocabulary.concepts;

const IndexSavedNote = reaction(({ note, text }) =>
  when(Notes.save({}).responds({ note, text })).then(SearchIndex.index({ note, text })),
);

function assembleNotebook(statePath: string, occurrencePath: string) {
  const occurrenceSink = new FileLogSink(occurrencePath);
  const application = assemble({
    vocabulary: notebookVocabulary,
    composition: { IndexSavedNote },
    instances: {
      Notes: new FileBackedNotes(statePath),
      SearchIndex: new SearchIndexConcept(),
    },
    logSink: occurrenceSink,
    retention: "keepAll",
  });
  return { application, occurrenceSink };
}

async function recoverSearchIndex(
  application: ReturnType<typeof assembleNotebook>["application"],
): Promise<void> {
  for (const note of await application.concepts.Notes._all({})) {
    await application.concepts.SearchIndex.index(note);
  }
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(join(tmpdir(), "sync-engine-recipes-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("advanced persistence recipe", () => {
  test("keeps durable concept state separate and recovers process-local derived state explicitly", async () => {
    const directory = temporaryDirectory();
    const statePath = join(directory, "notes.json");
    const occurrencePath = join(directory, "occurrences.jsonl");
    const first = assembleNotebook(statePath, occurrencePath);

    await expect(
      first.application.concepts.Notes.save({ note: "n1", text: "Durable note" }),
    ).resolves.toEqual({ note: "n1", text: "Durable note" });
    expect(await first.application.concepts.SearchIndex._all({})).toEqual([
      { note: "n1", text: "Durable note" },
    ]);

    expect(statePath).not.toBe(occurrencePath);
    expect(fs.readFileSync(statePath, "utf8")).toBe('[{"note":"n1","text":"Durable note"}]\n');
    const firstEvidence = fs.readFileSync(occurrencePath, "utf8");
    const invocationNames = firstEvidence
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; concept?: string; action?: string })
      .filter((entry) => entry.kind === "invocation")
      .map((entry) => `${entry.concept}.${entry.action}`);
    expect(invocationNames).toEqual(["Notes.save", "SearchIndex.index"]);

    await first.application.beginDrain();

    const restarted = assembleNotebook(statePath, occurrencePath);
    expect(await restarted.application.concepts.Notes._all({})).toEqual([
      { note: "n1", text: "Durable note" },
    ]);
    expect(await restarted.application.concepts.SearchIndex._all({})).toEqual([]);
    expect(fs.readFileSync(occurrencePath, "utf8")).toBe(firstEvidence);

    await recoverSearchIndex(restarted.application);
    expect(await restarted.application.concepts.SearchIndex._all({})).toEqual([
      { note: "n1", text: "Durable note" },
    ]);
    expect(fs.readFileSync(occurrencePath, "utf8").length).toBeGreaterThan(firstEvidence.length);
  });
});
