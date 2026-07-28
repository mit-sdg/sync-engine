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
import { FileStore, MemoryStore, assemble } from "@mit-sdg/sync-engine/assembly";
import {
  command,
  createCliApp,
  endpoint,
  fail,
  ok,
  parseFail,
  parseOk,
  receive,
  respond,
} from "@mit-sdg/sync-engine/boundary";
import type { CliResult } from "@mit-sdg/sync-engine/boundary";
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

`PersistingConcept` is not state persistence: it manages application-supplied
log-store bindings and does not bind concept state or install an assembly store.
Neither this illustrative file-backed concept nor `FileStore` is a
transactional production database. A production implementation must define
atomic writes, schema migration, concurrency, durability, and recovery failure
handling in its own storage layer and host.

## An inbound application CLI

`command(...)` adapts an application endpoint to arguments and a `CliResult`.
`createCliApp` receives the invoker from the real assembly, so a valid command
enters the same endpoint boundary as another in-process adapter. The final
function is the deliberately small process projection: write the returned
streams and assign the returned exit code.

```ts
class GreetingConcept {
  greet({ name, loud }: { name: string; loud: boolean }): { greeting: string } {
    const greeting = `Hello, ${name}!`;
    return { greeting: loud ? greeting.toUpperCase() : greeting };
  }
}

const greetingVocabulary = vocabulary({ concepts: { Greeting: GreetingConcept } });
const { Greeting } = greetingVocabulary.concepts;

const Greet = endpoint("/greet", ({ name, loud, greeting }) =>
  receive({ name, loud })
    .then(Greeting.greet({ name, loud }).responds({ greeting }))
    .then(respond({ greeting })),
);

const GreetCommand = command<{ name: string; loud: boolean }, { greeting: string }, string>(Greet, {
  description: "Greet one person.",
  parse(positionals, options) {
    if (positionals.length !== 1) return parseFail("Usage: greetings greet NAME [--loud]");
    return parseOk({ name: positionals[0]!, loud: options.loud === true });
  },
  format(result) {
    if (result.ok) return ok(result.value.greeting);
    return fail(result.error.kind === "domain" ? result.error.value : result.error.code);
  },
});

function assembleGreetingCli() {
  const occurrenceStore = new MemoryStore("keepAll");
  const application = assemble({
    vocabulary: greetingVocabulary,
    composition: { Greet },
    logStore: occurrenceStore,
  });
  const cli = createCliApp(
    { greet: GreetCommand },
    { name: "greetings", version: "1.0.0", invoker: application.invoker },
  );
  return { application, cli, occurrenceStore };
}

interface ProcessTarget {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  exitCode?: string | number | null;
}

async function projectCliProcess(
  cli: { run(args: string[]): Promise<CliResult> },
  args: string[],
  target: ProcessTarget = process,
): Promise<void> {
  const result = await cli.run(args);
  if (result.stdout !== "") target.stdout.write(result.stdout);
  if (result.stderr !== "") target.stderr.write(result.stderr);
  target.exitCode = result.exitCode;
}
```

The successful path parses one positional and the `--loud` flag, invokes
`/greet`, formats the endpoint result, and projects it to stdout:

```console
$ greetings greet Ada --loud
HELLO, ADA!
```

With no name, `parseFail` returns before the invoker is called. The application
records no request, concept action, response, or firing occurrence:

```console
$ greetings greet
Usage: greetings greet NAME [--loud]
$ echo $?
1
```

This is an inbound CLI for this assembled application. It is distinct from the
installed maintainer-facing `sync-engine` executable, whose `new`, `check`, and
`artifacts` commands are documented in the [CLI reference](./cli.md).
