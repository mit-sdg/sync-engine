/**
 * Compare parsed action and query declarations with their TypeScript classes.
 *
 * Registration makes the same comparison when an application starts, but by
 * then a parameter's type is gone: `end(_: { session: string })` reaches the
 * engine as `end(_)`, and its declared input cannot be recovered. Runtime
 * therefore compares inputs only for a method that destructures them, and
 * stays silent about one that does not.
 *
 * Reading the source recovers what erasure removed. A parsed action or query
 * signature that disagrees with the class fails here even when the
 * implementation never names its inputs. State prose and class fields are not
 * inputs to this check. Run it from `bun run check`.
 */

import { resolve } from "node:path";
import { conceptDirectories, conceptFailures } from "../src/command/check.ts";

const root = resolve(import.meta.dirname, "..");

/** Where authored concepts live: any directory below these holding a `spec.md`. */
const conceptRoots = ["examples", "tests/packaging/application"];

if (import.meta.main) {
  const directories = await conceptDirectories(conceptRoots, root);
  const failures = directories.flatMap((directory) => conceptFailures(directory, root));
  if (failures.length > 0) {
    throw new Error(
      `Concept action/query source check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`concept action/query source check passed for ${directories.length} concepts`);
}
