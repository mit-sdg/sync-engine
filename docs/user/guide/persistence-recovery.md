# Persistence, restart, and recovery

This restart arrangement separates durable concept state, occurrence evidence,
and process-local derived state. See the [application authoring guide](../index.md#application-authoring-path)
for the assembly lifecycle and the [persistence](../reference/operations.md#persistence-and-restart)
and [execution](../reference/semantics.md#logs-concept-implementations-and-restart)
contracts.

```ts
import * as fs from "node:fs";
```

```ts
import { FileLogSink, assemble } from "@mit-sdg/sync-engine/assembly";
import { reaction, vocabulary, when } from "@mit-sdg/sync-engine/language";
```

## Ownership

`FileBackedNotes` owns durable note state, `FileLogSink` uses a separate JSONL
path, and a reaction derives the process-local search index. Production state
storage must provide required atomicity and coordination; this example writes
the state file directly.

| Concern             | Owner                                | What survives restart                               |
| ------------------- | ------------------------------------ | --------------------------------------------------- |
| Occurrence evidence | Assembly host through `FileLogSink`  | JSONL bytes only; every assembly owns a fresh index |
| Concept state       | `FileBackedNotes` and its state file | Saved notes, loaded by a fresh concept instance     |
| Derived state       | `SearchIndexConcept` process         | Nothing automatically                               |
| Restart recovery    | Host/application code                | Explicit policy in `recoverSearchIndex`             |

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
```

## Recovery sequence

1. Construct the first assembly with separate concept-state and occurrence
   paths.
2. Call `Notes.save`. The concept writes its state file, the reaction updates
   the process-local index, and `FileLogSink` appends occurrence evidence.
3. Stop the external listener, then await `application.beginDrain()` before
   closing resources or starting the replacement. Drain closes assembly root
   admission and waits for accepted, engine-tracked causal flows. Detached work
   is not tracked and must be settled through the concept or host lifecycle.
4. Construct a new assembly. `FileBackedNotes` loads durable state, while the
   new search index and the assembly's occurrence index begin empty. Do not
   attach the new assembly to a listener yet.
5. Call `recoverSearchIndex`. The recovery procedure reads durable concept
   state and invokes the index action explicitly. Start admission only after it
   succeeds.

A successful `Notes.save` writes `notes.json`; the assembly records action and
reaction evidence in `occurrences.jsonl`. On reconstruction, `FileBackedNotes`
loads `notes.json`, but `FileLogSink` does not read the existing JSONL file,
rebuild the occurrence index, replay reactions, or rebuild the search index.
`recoverSearchIndex` must rebuild from durable concept state before admission.
Recovery is not transactional: on partial failure, retry an idempotent recovery,
discard and rebuild derived state, or stop startup.

The state and occurrence writes do not form one commit. `FileBackedNotes.save`
changes memory before writing `notes.json`; the engine appends outcome and
reaction evidence after the action returns. A state-file failure can leave
changed memory. A later append failure can leave durable state without complete
occurrence evidence or derived state. The engine rolls back neither case.

`FileLogSink` synchronously appends JSONL audit output without locking,
shared-writer coordination, flush or durability guarantees, or a close method.
Concept storage and custom sinks must define atomic writes, migration,
concurrency, durability, and recovery failure handling.
