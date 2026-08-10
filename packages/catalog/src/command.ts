#!/usr/bin/env bun
import { runCatalog } from "./cli.ts";

try {
  await runCatalog(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
