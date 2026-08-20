import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const conceptRoot = "packages/catalog/entries/concept";
const listingPath = "packages/skill/skills/sync-engine/prompts/inputs/catalog.md";

const preamble = `# Catalog concepts

These concepts are already generic: each names a mechanism rather than a product, and
takes what it acts on as an opaque parameter. Cover a need by instantiating one where it
fits, adapt one where it nearly fits, and invent only where none does. They are
alternatives, never mandatory names or contracts, and these are all there are. Most
briefs need a mechanism none of them covers, so "no entry fits, because ..." is an
expected answer rather than a fault.
`;

/** The listing is derived: a hand-kept copy teaches mechanisms the catalog does not ship. */
export async function catalogListing(projectRoot = process.cwd()): Promise<string> {
  const root = resolve(projectRoot, conceptRoot);
  const entries = (await readdir(root)).filter((entry) => !entry.startsWith("_")).sort();
  const rows = await Promise.all(
    entries.map(async (entry) => {
      const spec = await readFile(resolve(root, entry, "spec.md"), "utf8");
      const name = spec.slice(2, spec.indexOf("\n")).trim();
      const purpose = spec.split("## Purpose")[1]?.split("## Principle")[0] ?? "";
      return `- **${name}** — ${purpose.split(/\s+/).filter(Boolean).join(" ")}`;
    }),
  );
  return `${preamble}\n${rows.join("\n")}\n`;
}

export { listingPath };
