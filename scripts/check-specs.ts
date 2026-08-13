/** Check repository applications and registered catalog concepts through command discovery. */

import { checkCommand } from "../src/command/check.ts";
import { applicationExamples } from "../examples/register.ts";

const checks: readonly (readonly string[])[] = [
  ...Object.values(applicationExamples).map(({ directory }) => [
    "--config",
    `examples/${directory}/generated.config.ts`,
  ]),
  ["--vocabulary-module", "packages/catalog/entries/_typecheck/concept-set.ts"],
  ["--config", "tests/packaging/application/generated.config.ts"],
];

if (import.meta.main) {
  for (const arguments_ of checks) await checkCommand(arguments_);
  console.log(`repository concept checks passed for ${checks.length} registered roots`);
}
