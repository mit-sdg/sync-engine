/** Check repository applications and catalog concept sources through their owned registrations. */

import { checkCommand } from "../src/command/check.ts";
import { applicationExamples } from "../examples/register.ts";
import { validateCatalogConcepts } from "./validate-catalog-concepts.ts";

const applicationConfigs = [
  ...Object.values(applicationExamples).map(
    ({ directory }) => `examples/${directory}/generated.config.ts`,
  ),
  "tests/packaging/application/generated.config.ts",
];
if (import.meta.main) {
  for (const config of applicationConfigs) await checkCommand(["--config", config]);
  const catalogConcepts = await validateCatalogConcepts();
  console.log(
    `repository checks passed for ${applicationConfigs.length} configured applications and ${catalogConcepts} catalog concepts`,
  );
}
