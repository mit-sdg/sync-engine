import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Logging, SyncConcept } from "@sync-engine/engine";
import {
  FocusConcept,
  type FocusState,
  HistoryConcept,
  type HistoryState,
  type Priority,
  WorkConcept,
  type WorkItem,
  type WorkState,
} from "./concepts.ts";
import { makeStitchSyncs } from "./syncs.ts";

interface StitchState {
  work: WorkState;
  focus: FocusState;
  history: HistoryState;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const HELP = `stitch - a small, durable work queue

Usage:
  stitch add <title> [--priority low|normal|high]
  stitch list [--all]
  stitch start <id>
  stitch done <id>
  stitch status
  stitch log
  stitch help`;

const EMPTY_STATE: StitchState = {
  work: { nextId: 1, items: [] },
  focus: { current: null, sessions: [] },
  history: { entries: [] },
};

function fail(message: string): CliResult {
  return { stdout: "", stderr: `${message}\n`, exitCode: 1 };
}

function success(stdout: string): CliResult {
  return { stdout: `${stdout}\n`, stderr: "", exitCode: 0 };
}

function isError(value: unknown): value is { error: string; detail: string } {
  return typeof value === "object" && value !== null && "error" in value && "detail" in value;
}

async function loadState(file: string): Promise<StitchState> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as StitchState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_STATE);
    throw error;
  }
}

async function saveState(file: string, state: StitchState): Promise<void> {
  const temporary = join(dirname(file), `.${process.pid}.stitch.tmp`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, file);
}

function formatItem(item: WorkItem): string {
  const marker = item.status === "active" ? ">" : item.status === "done" ? "x" : " ";
  return `${marker} ${item.id}  ${item.priority.padEnd(6)}  ${item.title}`;
}

function parseAdd(args: string[]): { title: string; priority: Priority } | CliResult {
  let priority: Priority = "normal";
  const title: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--priority") {
      title.push(args[index]);
      continue;
    }
    const value = args[index + 1];
    if (value !== "low" && value !== "normal" && value !== "high") {
      return fail("priority must be low, normal, or high");
    }
    priority = value;
    index += 1;
  }
  if (title.length === 0) return fail("usage: stitch add <title> [--priority low|normal|high]");
  return { title: title.join(" "), priority };
}

export async function runCli(args: string[], stateFile: string): Promise<CliResult> {
  const command = args[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") return success(HELP);

  const state = await loadState(stateFile);
  const engine = new SyncConcept();
  engine.logging = Logging.OFF;
  const { Work, Focus, History } = engine.instrument({
    Work: new WorkConcept(state.work),
    Focus: new FocusConcept(state.focus),
    History: new HistoryConcept(state.history),
  });
  engine.register(makeStitchSyncs(Work, Focus, History));

  if (command === "add") {
    const input = parseAdd(args.slice(1));
    if ("exitCode" in input) return input;
    const result = await Work.add(input);
    if (isError(result)) return fail(result.detail);
    await saveState(stateFile, state);
    return success(`Added ${result.item} [${result.priority}] ${result.title}`);
  }

  if (command === "list") {
    if (args.some((arg) => arg !== "list" && arg !== "--all")) {
      return fail("usage: stitch list [--all]");
    }
    const includeDone = args.includes("--all");
    const items = Work._list({}).filter((item) => includeDone || item.status !== "done");
    return success(items.length > 0 ? items.map(formatItem).join("\n") : "No work in the queue.");
  }

  if (command === "start" || command === "done") {
    const id = args[1]?.toUpperCase();
    if (!id || args.length !== 2) return fail(`usage: stitch ${command} <id>`);
    const result = command === "start" ? await Work.activate({ id }) : await Work.complete({ id });
    if (isError(result)) return fail(result.detail);
    await saveState(stateFile, state);
    return success(command === "start" ? `Focusing ${id}: ${result.title}` : `Completed ${id}`);
  }

  if (command === "status") {
    const current = Focus._current({})[0];
    if (!current) return success("Nothing in focus.");
    const item = Work._get({ id: current.item })[0];
    return success(`In focus: ${formatItem(item).slice(2)}`);
  }

  if (command === "log") {
    const entries = History._list({});
    const lines = entries.map(
      (entry) =>
        `${String(entry.sequence).padStart(2)}  ${entry.verb.padEnd(9)} ${entry.item}  ${entry.title}`,
    );
    return success(lines.length > 0 ? lines.join("\n") : "No history yet.");
  }

  return fail(`unknown command: ${command}\nRun 'stitch help' for usage.`);
}
