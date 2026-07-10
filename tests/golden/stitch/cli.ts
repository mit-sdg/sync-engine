#!/usr/bin/env bun
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "./app.ts";

export async function main(args = process.argv.slice(2)): Promise<number> {
  const stateFile = process.env.STITCH_FILE ?? resolve(".stitch.json");
  try {
    const result = await runCli(args, stateFile);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.exitCode;
  } catch (error) {
    process.stderr.write(`stitch: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
