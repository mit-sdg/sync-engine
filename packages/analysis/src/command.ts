#!/usr/bin/env node
import { runAnalysisCli } from "./cli.ts";

try {
  await runAnalysisCli(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
