#!/usr/bin/env bun

import { artifactsCommand } from "./artifacts.ts";
import { scaffoldProject } from "./scaffold.ts";
import { checkCommand } from "./check.ts";
import { describeError } from "@engine/utils/redaction";

const usage = `Usage: sync-engine <topic> <command>

  sync-engine new <directory>
    Write a runnable project: one concept, its composition, and its config.

  sync-engine artifacts <command> [--config path]
    check      Verify the assembled read-back and wire contract against the assembly.
    pin        Regenerate the assembled read-back and wire contract.
    pin-spec   Regenerate only the assembled read-back.
    pin-wire   Regenerate only the wire contract.
    spec       Print assembly counts and the assembled read-back.
    wire       Print the wire contract.

  sync-engine check [--concepts <path...>]
    Verify every concept specification against its class.
    Defaults to src/concepts.`;

const HELP = new Set([undefined, "help", "--help", "-h"]);

async function main(): Promise<void> {
  const [topic, ...rest] = process.argv.slice(2);
  if (HELP.has(topic)) {
    console.log(usage);
    return;
  }

  if (topic === "new") {
    if (rest[0] === undefined) throw new Error(usage);
    const written = await scaffoldProject(rest[0]);
    console.log(`Wrote ${written.length} files into ${rest[0]}:`);
    for (const path of written) console.log(`  ${path}`);
    console.log(`\nNext: cd ${rest[0]} && bun install && bun run generate && bun run start`);
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
