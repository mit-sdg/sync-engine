# Advanced recipes

These recipes address host-owned edges after an application already has its
concepts, composition, and assembly. Start with the [application authoring
guide](./index.md#start-an-application) for the complete path from a scaffold to
an HTTP boundary. The
contracts behind these examples live in [Operational limits](./operations.md)
and [Execution semantics](./semantics.md).

The executable examples use only Node APIs and supported package subpaths:

```ts
import * as fs from "node:fs";
```

```ts
import { FileStore, assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
```

## Persistence, restart, and recovery

Keep domain state, occurrence evidence, and recovery policy separate. This
example gives `FileBackedNotes` ownership of durable note state, supplies a
different JSONL path to the assembly's `FileStore`, and derives a process-local
search index through a reaction.

| Concern             | Owner                                | What survives restart                                   |
| ------------------- | ------------------------------------ | ------------------------------------------------------- |
| Occurrence evidence | Assembly host through `FileStore`    | JSONL bytes only; a new store starts with empty indexes |
| Concept state       | `FileBackedNotes` and its state file | Saved notes, loaded by a fresh concept instance         |
| Derived state       | `SearchIndexConcept` process         | Nothing automatically                                   |
| Restart recovery    | Host/application code                | Explicit policy in `recoverSearchIndex`                 |

```ts
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
  const occurrenceStore = new FileStore(occurrencePath);
  const application = assemble({
    vocabulary: notebookVocabulary,
    composition: { IndexSavedNote },
    instances: {
      Notes: new FileBackedNotes(statePath),
      SearchIndex: new SearchIndexConcept(),
    },
    logStore: occurrenceStore,
  });
  return { application, occurrenceStore };
}

async function recoverSearchIndex(
  application: ReturnType<typeof assembleNotebook>["application"],
): Promise<void> {
  for (const note of await application.concepts.Notes._all({})) {
    await application.concepts.SearchIndex.index(note);
  }
}
```

A successful `Notes.save` writes `notes.json`, while the assembly records the
`Notes.save`, `SearchIndex.index`, and reaction evidence in a separate
`occurrences.jsonl`. Drain the old assembly before closing host resources and
constructing the replacement.

On reconstruction, `FileBackedNotes` loads `notes.json`. A new `FileStore` over
the existing `occurrences.jsonl` does **not** read that file into its in-memory
indexes, replay the old reaction, or rebuild the search index. The derived query
therefore remains empty until the host explicitly calls `recoverSearchIndex`,
which reads durable concept state and invokes the derived concept's action.

`FileStore` composes a live in-memory occurrence index with an append-only JSONL
audit sink; it is not a transactional production database. A production
implementation must define atomic writes, schema migration, concurrency,
durability, and recovery failure handling in its own storage layer and host.
