#!/usr/bin/env bun

import { artifactsCommand } from "./artifacts.ts";
import { setupProject } from "./setup.ts";
import { checkCommand } from "./check.ts";
import { describeError } from "@engine/utils/redaction";

const usage = `Usage: sync-engine <command> [arguments]

  sync-engine setup [directory]
    Initialize missing concept-free application files in an existing Bun package.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    manifest   Print the canonical application manifest as JSON.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

  sync-engine check [--vocabulary-module path | --config path] [--fail-on-warnings]
    Check registered concepts against erased TypeScript source and optionally inspect application diagnostics.
    Without a config, defaults to the conventional src/concept-set.ts vocabulary module.`;

const HELP = new Set([undefined, "help", "--help", "-h"]);

async function main(): Promise<void> {
  const [topic, ...rest] = process.argv.slice(2);
  if (HELP.has(topic)) {
    if (rest.length > 0) throw new Error(usage);
    console.log(usage);
    return;
  }

  if (topic === "setup") {
    if (rest.length > 1 || rest[0]?.startsWith("-")) throw new Error(usage);
    const directory = rest[0] ?? ".";
    const result = await setupProject(directory);
    if (result.written.length > 0) {
      console.log(`Wrote ${result.written.length} files into ${directory}:`);
      for (const path of result.written) console.log(`  ${path}`);
    } else {
      console.log(`No files written into ${directory}.`);
    }
    if (result.verified.length > 0) {
      console.log("Verified setup files:");
      for (const path of result.verified) console.log(`  ${path}`);
    }
    if (result.guidance.length > 0) {
      console.log("\nIntegration guidance:");
      for (const finding of result.guidance) console.log(`  ${finding}`);
    }
    console.log(
      "\nNext: apply any guidance, then run bun run generate && bun run check && bun run start",
    );
    return;
  }

  if (topic === "artifacts") {
    await artifactsCommand(rest);
    return;
  }

  if (topic === "check") {
    await checkCommand(rest);
    return;
  }

  throw new Error(usage);
}

try {
  await main();
} catch (error) {
  console.error(describeError(error));
  process.exitCode = 1;
}
