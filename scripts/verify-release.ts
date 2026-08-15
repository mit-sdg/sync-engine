import { resolve } from "node:path";
import { QuietCommandFailure, runQuietCommand } from "./command-output.ts";

const root = resolve(import.meta.dirname, "..");
const gates = [
  ["install", "--frozen-lockfile"],
  ["run", "release:check"],
  ["run", "check"],
  ["run", "test"],
  ["run", "coverage"],
  ["run", "declarations:check"],
  ["run", "examples:check"],
  ["scripts/examples.ts", "scenario"],
  ["run", "package:check"],
  ["audit"],
] as const;

const diagnosticKeys = new Set<string>();
let failedStatus: number | undefined;

for (const args of gates) {
  try {
    runQuietCommand("bun", args, {
      cwd: root,
      diagnosticKeys,
      env: process.env,
      stdin: "inherit",
    });
  } catch (error) {
    if (!(error instanceof QuietCommandFailure)) throw error;
    failedStatus = error.status;
    break;
  }
}

if (failedStatus === undefined) {
  console.log(`Release verification passed (${gates.length} gates).`);
} else {
  process.exitCode = failedStatus;
}
