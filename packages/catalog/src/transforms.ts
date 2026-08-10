import { posix } from "node:path";

export function transformConceptSpecifier(source: string, target: string): string {
  const from = posix.dirname(target);
  let replacement = posix.relative(from, "src/concept-set.ts");
  if (!replacement.startsWith(".")) replacement = `./${replacement}`;
  return source
    .replaceAll('"@catalog/concepts"', `"${replacement}"`)
    .replaceAll("'@catalog/concepts'", `'${replacement}'`);
}

const START = /^\s*\/\/#floor ([a-z][a-z0-9-]*)\s*$/;
const END = /^\s*\/\/#endfloor\s*$/;
const CLASS = /^\s*\/\/#class ([a-z][a-z0-9-]*) ([A-Za-z_$][\w$]*)\s*$/;
export function renderFloor(source: string, floor: string, available: readonly string[]): string {
  if (!available.includes(floor)) throw new Error(`unknown floor ${floor}`);
  const classes = new Map<string, string>();
  let active: string | undefined;
  let selectedLines = 0;
  const output: string[] = [];
  for (const line of source.split("\n")) {
    const start = START.exec(line);
    if (start !== null) {
      if (active !== undefined) throw new Error("nested floor blocks are not allowed");
      if (!available.includes(start[1] ?? ""))
        throw new Error(`registry contains unknown floor marker: ${start[1]}`);
      active = start[1];
      continue;
    }
    if (END.test(line)) {
      if (active === undefined) throw new Error("unbalanced endfloor marker");
      active = undefined;
      continue;
    }
    const marker = CLASS.exec(line);
    if (marker !== null) {
      const name = marker[1] ?? "";
      if (!available.includes(name) || classes.has(name))
        throw new Error(`invalid or duplicate class marker for ${name}`);
      classes.set(name, marker[2] ?? "");
      continue;
    }
    if (line.includes("//#floor") || line.includes("//#endfloor") || line.includes("//#class"))
      throw new Error(`invalid floor marker syntax: ${line.trim()}`);
    if (active === undefined || active === floor) {
      if (line.includes("// selected-class")) {
        const selectedClass = classes.get(floor);
        const replaced = line.replace(
          /class:\s*[A-Za-z_$][\w$]*,?\s*\/\/ selected-class/,
          `class: ${selectedClass ?? "__MISSING_CLASS__"},`,
        );
        if (selectedClass === undefined || replaced === line)
          throw new Error(`invalid selected-class line: ${line.trim()}`);
        selectedLines++;
        output.push(replaced);
      } else output.push(line);
    }
  }
  if (active !== undefined) throw new Error(`unbalanced floor block for ${active}`);
  if (classes.size !== available.length || available.some((name) => !classes.has(name)))
    throw new Error("every floor must have exactly one class marker");
  if (selectedLines !== 1) throw new Error("registry must contain exactly one selected-class line");
  return output.join("\n");
}
