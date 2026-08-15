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
const totals = report.match(
  /^All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/m,
);
if (totals === null) {
  writeCompleteCommandOutput(output);
  throw new Error("Coverage output omitted the all-files totals.");
}
const [, statements, branches, functions, lines] = totals;

console.log(`Coverage tests passed (${files} files, ${tests} tests; ${duration}).`);
console.log(
  `Coverage passed (statements ${statements}%, branches ${branches}%, ` +
    `functions ${functions}%, lines ${lines}%).`,
);
