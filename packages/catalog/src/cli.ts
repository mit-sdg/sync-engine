import { CatalogRegistry } from "./registry.ts";
import { addEntries } from "./install.ts";

const USAGE = `Usage: catalog <command> [arguments]

  catalog list [concept|recipe]
  catalog show <entry>
  catalog add <entry...> [--floor <name>]
  catalog help`;
function target(path: string): string {
  return path.replace(/^\$concepts\//, "src/concepts/").replace(/^\$recipes\//, "src/composition/");
}
export async function runCatalog(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (rest.length > 0) throw new Error(USAGE);
    console.log(USAGE);
    return;
  }
  const registry = await CatalogRegistry.load();
  if (command === "list") {
    if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== "concept" && rest[0] !== "recipe"))
      throw new Error(USAGE);
    for (const entry of registry.entries.values())
      if (rest[0] === undefined || entry.kind === rest[0])
        console.log(`${entry.id}\t${entry.kind}\t${entry.summary}`);
    return;
  }
  if (command === "show") {
    if (rest.length !== 1) throw new Error(USAGE);
    const entry = registry.entries.get(rest[0] ?? "");
    if (entry === undefined) throw new Error(`unknown catalog entry: ${rest[0]}`);
    console.log(`${entry.id} (${entry.kind})\n${entry.summary}`);
    console.log(`Requires: ${entry.requires.length ? entry.requires.join(", ") : "none"}`);
    if (entry.kind === "concept")
      for (const [floor, value] of Object.entries(entry.floors ?? {})) {
        console.log(
          `Floor ${floor}${floor === entry.defaultFloor ? " (default)" : ""}: ${value.summary}`,
        );
        const requirements = { ...entry.packages, ...value.packages };
        console.log(
          `  Packages: ${Object.entries(requirements)
            .map(([name, range]) => `${name}@${range}`)
            .join(", ")}`,
        );
        for (const file of [...entry.files, ...value.files])
          console.log(`  ${target(file.target)}`);
      }
    if (entry.kind === "recipe") {
      console.log(`Members: ${entry.recipe.members.join(", ")}`);
      for (const member of entry.recipe.members)
        console.log(`  ${member}: ${entry.recipe.routes[member]}`);
      for (const file of entry.files) console.log(`  ${target(file.target)}`);
    }
    return;
  }
  if (command === "add") {
    const ids: string[] = [];
    let floor: string | undefined;
    for (let index = 0; index < rest.length; index++) {
      const argument = rest[index] ?? "";
      if (argument === "--floor") {
        if (floor !== undefined) throw new Error("--floor may be specified only once");
        floor = rest[++index];
        if (floor === undefined || floor === "" || floor.includes(","))
          throw new Error("--floor requires one nonempty floor name without commas");
      } else if (argument.startsWith("-")) throw new Error(`unknown option: ${argument}`);
      else ids.push(argument);
    }
    if (ids.length === 0) throw new Error(USAGE);
    const result = await addEntries(registry, ids, {
      floor,
      originalCommand: `catalog ${args.join(" ")}`,
    });
    if (result.written.length > 0) {
      console.log("Wrote:");
      for (const path of result.written) console.log(`  ${path}`);
    }
    for (const line of result.guidance) console.log(line);
    if (result.install !== undefined) process.exitCode = 1;
    return;
  }
  throw new Error(USAGE);
}
