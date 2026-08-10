import semver from "semver";

export interface PackageFinding {
  name: string;
  required: string;
  actual?: string;
}
function declarations(manifest: Record<string, unknown>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    const value = manifest[section];
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
      if (typeof range !== "string") continue;
      found.set(name, [...(found.get(name) ?? []), range]);
    }
  }
  return found;
}
export function verifyPackages(
  manifest: Record<string, unknown>,
  requirements: Record<string, string>,
): PackageFinding[] {
  const declared = declarations(manifest);
  const findings: PackageFinding[] = [];
  for (const [name, required] of Object.entries(requirements).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (semver.validRange(required) === null)
      throw new Error(
        `catalog requirement for ${name} is not a semantic-version range: ${required}`,
      );
    const values = declared.get(name) ?? [];
    if (new Set(values).size > 1)
      throw new Error(`conflicting package declarations for ${name}: ${values.join(", ")}`);
    const actual = values[0];
    if (actual === undefined) findings.push({ name, required });
    else if (
      semver.validRange(actual) === null ||
      (semver.valid(actual) !== null
        ? !semver.satisfies(actual, required, { includePrerelease: true })
        : !semver.subset(actual, required, { includePrerelease: true }))
    )
      findings.push({ name, required, actual });
  }
  return findings;
}
export function installCommand(findings: readonly PackageFinding[]): string {
  return `bun add --exact ${findings.map(({ name, required }) => `${name}@${required}`).join(" ")}`;
}
