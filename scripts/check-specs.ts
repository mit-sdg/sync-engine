/** Check repository applications and catalog concept sources through their owned registrations. */

import { checkCommand } from "../src/command/check.ts";
import { applicationExamples } from "../examples/register.ts";
import { validateCatalogConcepts } from "./validate-catalog-concepts.ts";
import { catalogListing, listingPath } from "./catalog-listing.ts";

const applicationConfigs = [
  ...Object.values(applicationExamples).map(
    ({ directory }) => `examples/${directory}/generated.config.ts`,
  ),
  "tests/packaging/application/generated.config.ts",
];
if (import.meta.main) {
  for (const config of applicationConfigs) await checkCommand(["--config", config]);
  const catalogConcepts = await validateCatalogConcepts();
  // The skill ships a materialised listing because the installed skill cannot read the
  // catalog package; a stale one teaches mechanisms the catalog does not have.
  const listing = await Bun.file(listingPath)
    .text()
    .catch(() => "");
  if (listing !== (await catalogListing())) {
    throw new Error(`Catalog listing is stale: run \`bun run catalog:listing\` (${listingPath})`);
  }
  console.log(
    `repository checks passed for ${applicationConfigs.length} configured applications and ${catalogConcepts} catalog concepts`,
  );
}
