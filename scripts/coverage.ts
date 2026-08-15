import { resolve } from "node:path";
import { runQuietCommand, stripAnsi, writeCompleteCommandOutput } from "./command-output.ts";

const root = resolve(import.meta.dirname, "..");
const output = runQuietCommand(
  "node",
  [
    resolve(root, "node_modules/vite-plus/bin/vp"),
    "test",
    "--coverage",
    "--maxWorkers=2",
    "--testTimeout=30000",
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    displayCommand: "vp",
    env: { ...process.env, LOG_LEVEL: "error" },
  },
);
const report = stripAnsi(output.stdout.toString("utf8"));

function capture(pattern: RegExp, description: string): string {
  const value = report.match(pattern)?.[1];
  if (value !== undefined) return value;
  writeCompleteCommandOutput(output);
  throw new Error(`Coverage output omitted ${description}.`);
}

const files = capture(/Test Files\s+(\d+) passed/, "the passed file count");
const tests = capture(/Tests\s+(\d+) passed/, "the passed test count");
const duration = capture(/Duration\s+(\S+)/, "the duration");
const statements = capture(/^Statements\s*:\s*([\d.]+)%/m, "statement coverage");
const branches = capture(/^Branches\s*:\s*([\d.]+)%/m, "branch coverage");
const functions = capture(/^Functions\s*:\s*([\d.]+)%/m, "function coverage");
const lines = capture(/^Lines\s*:\s*([\d.]+)%/m, "line coverage");

console.log(`Coverage tests passed (${files} files, ${tests} tests; ${duration}).`);
console.log(
  `Coverage passed (statements ${statements}%, branches ${branches}%, ` +
    `functions ${functions}%, lines ${lines}%).`,
);
