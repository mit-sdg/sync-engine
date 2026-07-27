/**
 * Hold every concept specification to its class, reading the TypeScript source.
 *
 * Registration makes the same comparison when an application starts, but by
 * then a parameter's type is gone: `end(_: { session: string })` reaches the
 * engine as `end(_)`, and its declared input cannot be recovered. Runtime
 * therefore compares inputs only for a method that destructures them, and
 * stays silent about one that does not.
 *
 * Reading the source recovers what erasure removed. A signature that disagrees
 * with its specification fails here even when the implementation never names
 * its inputs — a placeholder parameter, a plain named parameter, or none at
 * all. Run it from `bun run check`.
 */

import { resolve } from "node:path";
import { conceptDirectories, conceptFailures } from "../src/command/check.ts";

const root = resolve(import.meta.dirname, "..");

/** Where authored concepts live: any directory below these holding a `spec.md`. */
const conceptRoots = ["examples", "tests/package/application"];

if (import.meta.main) {
  const directories = await conceptDirectories(conceptRoots, root);
  const failures = directories.flatMap((directory) => conceptFailures(directory, root));
  if (failures.length > 0) {
    throw new Error(
      `Concept specification check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`specification check passed for ${directories.length} concepts`);
}
