#!/usr/bin/env bun

import { artifactsCommand } from "./artifacts.ts";
import { scaffoldProject } from "./scaffold.ts";
import { checkCommand } from "./check.ts";
import { describeError } from "@engine/utils/redaction";

const usage = `Usage: sync-engine <command> [arguments]

  sync-engine new <directory>
    Write a runnable project: one concept, its composition, and its config.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    manifest   Print the canonical application manifest as JSON.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

  sync-engine check [--concepts <path...>] [--config path] [--fail-on-warnings]
    Check parsed action/query declarations against class source and optionally inspect application diagnostics.
    Defaults to src/concepts.`;

const HELP = new Set([undefined, "help", "--help", "-h"]);

async function main(): Promise<void> {
  const [topic, ...rest] = process.argv.slice(2);
  if (HELP.has(topic)) {
    if (rest.length > 0) throw new Error(usage);
    console.log(usage);
    return;
  }

  if (topic === "new") {
    if (rest.length !== 1 || rest[0].startsWith("-")) throw new Error(usage);
    const written = await scaffoldProject(rest[0]);
    console.log(`Wrote ${written.length} files into ${rest[0]}:`);
    for (const path of written) console.log(`  ${path}`);
    console.log(
      `\nNext: cd ${rest[0]} && bun install && bun run generate && bun run check && bun run start`,
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
