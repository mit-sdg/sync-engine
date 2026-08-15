import { resolve } from "node:path";
import { applicationExamples } from "../examples/register.ts";
import { runQuietCommand } from "./command-output.ts";

const root = resolve(import.meta.dirname, "..");
const [operation, requested] = process.argv.slice(2);

const selected = Object.entries(applicationExamples).filter(
  ([name]) => requested === undefined || name === requested,
);

if (selected.length === 0) throw new Error(`Unknown application example: ${requested}.`);
if (operation !== "scenario" && operation !== "check" && operation !== "pin") {
  throw new Error(`Unknown example operation: ${operation}.`);
}

function run(command: string, args: string[]): void {
  runQuietCommand(command, args, { cwd: root, env: process.env });
}

let completed = 0;
for (const [, example] of selected) {
  const directory = `examples/${example.directory}`;
  if (operation === "scenario") {
    if (!("scenario" in example)) continue;
    run("bun", [`${directory}/${example.scenario}`]);
  } else {
    run("bun", [
      "src/command/main.ts",
      "artifacts",
      operation,
      "--config",
      `${directory}/generated.config.ts`,
    ]);
  }
  completed++;
}

const applications = `${completed} application${completed === 1 ? "" : "s"}`;
if (operation === "scenario" && completed > 0) {
  console.log(`Example scenarios passed for ${applications}.`);
} else if (operation === "check") {
  console.log(`Example artifact checks passed for ${applications}.`);
} else if (operation === "pin") {
  console.log(`Example artifacts pinned for ${applications}.`);
}
