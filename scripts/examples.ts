import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { applicationExamples } from "../examples/register.ts";

const root = resolve(import.meta.dirname, "..");
const [operation, requested] = process.argv.slice(2);

const selected = Object.entries(applicationExamples).filter(
  ([name]) => requested === undefined || name === requested,
);

if (selected.length === 0) throw new Error(`Unknown application example: ${requested}.`);

function run(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: root, env: process.env, stdio: "inherit" });
}

for (const [, example] of selected) {
  const directory = `examples/${example.directory}`;
  if (operation === "scenario") {
    run("bun", [`${directory}/src/scenario.ts`]);
  } else if (operation === "check") {
    run("bun", [
      "src/command/artifacts.ts",
      "artifacts",
      "check",
      "--config",
      `${directory}/generated.config.ts`,
    ]);
  } else if (operation === "pin") {
    run("bun", [
      "src/command/artifacts.ts",
      "artifacts",
      "pin",
      "--config",
      `${directory}/generated.config.ts`,
    ]);
  } else if (operation === "test") {
    run(resolve(root, "node_modules/.bin/vp"), [
      "test",
      `tests/examples/${example.directory}.test.ts`,
    ]);
  } else {
    throw new Error(`Unknown example operation: ${operation}.`);
  }
}
