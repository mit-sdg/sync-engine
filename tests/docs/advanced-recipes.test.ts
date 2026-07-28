import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(first.application.concepts.SearchIndex._all({})).toEqual([
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
    first.occurrenceStore.stop();

    const restarted = assembleNotebook(statePath, occurrencePath);
    expect(restarted.occurrenceStore.actions.size).toBe(0);
    expect(restarted.application.concepts.Notes._all({})).toEqual([
      { note: "n1", text: "Durable note" },
    ]);
    expect(restarted.application.concepts.SearchIndex._all({})).toEqual([]);
    expect(fs.readFileSync(occurrencePath, "utf8")).toBe(firstEvidence);

    await recoverSearchIndex(restarted.application);
    expect(restarted.application.concepts.SearchIndex._all({})).toEqual([
      { note: "n1", text: "Durable note" },
    ]);
    expect(restarted.occurrenceStore.actions.size).toBe(1);
  });
});

describe("advanced inbound CLI recipe", () => {
  test("projects a successful real endpoint invocation onto a process", async () => {
    const { cli, occurrenceStore } = assembleGreetingCli();
    let stdout = "";
    let stderr = "";
    const target: ProcessTarget = {
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
    };

    await projectCliProcess(cli, ["greet", "Ada", "--loud"], target);

    expect({ stdout, stderr, exitCode: target.exitCode }).toEqual({
      stdout: "HELLO, ADA!\n",
      stderr: "",
      exitCode: 0,
    });
    expect(occurrenceStore.actions.size).toBe(3);
  });

  test("returns parseFail before entering the application or recording an occurrence", async () => {
    const { cli, occurrenceStore } = assembleGreetingCli();

    await expect(cli.run(["greet"])).resolves.toEqual({
      stdout: "",
      stderr: "Usage: greetings greet NAME [--loud]\n",
      exitCode: 1,
    });
    expect(occurrenceStore.actions.size).toBe(0);
  });
});
