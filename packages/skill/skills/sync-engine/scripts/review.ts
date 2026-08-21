export interface MapSnapshot {
  readonly rows: readonly string[];
  readonly placements: readonly string[];
  readonly obligationIds: readonly string[];
}

export interface ReviewExpectation {
  readonly mapRows?: readonly string[];
  readonly placementIds?: readonly string[];
  readonly obligationIds?: readonly string[];
}

function tableIdentity(line: string): string | undefined {
  const cell = line.match(/^\|\s*(?:\*\*|`)?([A-Za-z][A-Za-z0-9_-]*)(?:\*\*|`)?\s*\|/)?.[1];
  if (cell === undefined || cell === "Need" || cell === "Concept") return undefined;
  return cell;
}

/** Read the two required tables and obligation identifiers from a decomposition. */
export function snapshotMap(source: string): MapSnapshot {
  const rows: string[] = [];
  const placements: string[] = [];
  const obligations = new Set<string>();
  let section: "placements" | "rows" | "obligations" | undefined;

  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1]?.toLowerCase();
    if (heading !== undefined) {
      section = heading.includes("placement")
        ? "placements"
        : heading.includes("concept")
          ? "rows"
          : heading.includes("obligation") || heading.includes("consequence")
            ? "obligations"
            : undefined;
      continue;
    }
    if (section === "placements" || section === "rows") {
      const name = tableIdentity(line);
      if (name === undefined) continue;
      const target = section === "placements" ? placements : rows;
      if (target.includes(name)) {
        throw new Error(
          `Decomposition repeats ${section === "placements" ? "need" : "concept"} ${name}`,
        );
      }
      target.push(name);
      continue;
    }
    if (section === "obligations") {
      const match = line.match(
        /^\s*-\s+(?:\*\*(O[1-9][0-9]*):\*\*|`(O[1-9][0-9]*)`\s*:|(?:\*\*|`)?(O[1-9][0-9]*)(?:\*\*|`)?\s*:)/,
      );
      const id = match?.[1] ?? match?.[2] ?? match?.[3];
      if (id !== undefined) obligations.add(id);
    }
  }

  return {
    rows,
    placements,
    obligationIds: [...obligations].sort(
      (left, right) => Number(left.slice(1)) - Number(right.slice(1)),
    ),
  };
}

interface MapVerdict {
  readonly kind: "row" | "placement" | "blocker";
  readonly name?: string;
  readonly verdict?: string;
}

function mapVerdicts(response: string): readonly MapVerdict[] | undefined {
  const lines = response.split("\n").filter((line) => line.trim() !== "");
  const verdicts: MapVerdict[] = [];
  for (const line of lines) {
    const row = line.match(
      /^- ROW `design\/decomposition\.md` — ([A-Za-z][A-Za-z0-9_-]*) — (accept|split|merge with [A-Za-z][A-Za-z0-9_-]*) — .+$/,
    );
    if (row !== null) {
      verdicts.push({ kind: "row", name: row[1]!, verdict: row[2]! });
      continue;
    }
    const placement = line.match(
      /^- PLACEMENT `(N[1-9][0-9]*)` — (accept|reassign to (?:concept|composition|host|implementation|evidence)(?: [A-Za-z][A-Za-z0-9_-]*)?) — .+$/,
    );
    if (placement !== null) {
      verdicts.push({ kind: "placement", name: placement[1]!, verdict: placement[2]! });
      continue;
    }
    if (/^- (?:AUTHORITY|OBLIGATION) — .+$/.test(line)) {
      verdicts.push({ kind: "blocker" });
      continue;
    }
    return undefined;
  }
  return verdicts;
}

function exactNames(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((name) => actual.includes(name))
  );
}

export function mapResponseViolation(
  response: string,
  expectation: ReviewExpectation = {},
): string | undefined {
  const verdicts = mapVerdicts(response);
  if (verdicts === undefined) return "map critic used a line outside its exact verdict forms";
  const rows = verdicts.filter((entry) => entry.kind === "row");
  const placements = verdicts.filter((entry) => entry.kind === "placement");
  if (rows.length === 0 || placements.length === 0) {
    return "map critic must include ROW and PLACEMENT verdicts";
  }
  if (
    expectation.mapRows !== undefined &&
    !exactNames(
      rows.map((entry) => entry.name!),
      expectation.mapRows,
    )
  ) {
    return "map critic must rule every current concept row exactly once";
  }
  if (
    expectation.placementIds !== undefined &&
    !exactNames(
      placements.map((entry) => entry.name!),
      expectation.placementIds,
    )
  ) {
    return "map critic must rule every current need placement exactly once";
  }
  return undefined;
}

export function mapResponseAccepted(response: string): boolean {
  const verdicts = mapVerdicts(response);
  return (
    verdicts !== undefined &&
    verdicts.some((entry) => entry.kind === "row") &&
    verdicts.some((entry) => entry.kind === "placement") &&
    verdicts.every(
      (entry) => (entry.kind === "row" || entry.kind === "placement") && entry.verdict === "accept",
    )
  );
}

/** A clean contract verdict is accepted only with complete obligation and brief checks. */
export function contractCleanViolation(
  response: string,
  obligationIds?: readonly string[],
): string | undefined {
  const lines = response.split("\n").filter((line) => line.trim() !== "");
  if (lines.at(-1) !== "- VERDICT — No material findings.") {
    return "clean contract review must end with its exact VERDICT line";
  }
  const checks: string[] = [];
  for (const line of lines.slice(0, -1)) {
    const match = line.match(/^- CHECK `(O[1-9][0-9]*|BRIEF)` — .+$/);
    if (match === null) return "clean contract review must use only CHECK lines before VERDICT";
    checks.push(match[1]!);
  }
  if (
    !exactNames(
      checks.filter((name) => name !== "BRIEF"),
      obligationIds ?? [],
    )
  ) {
    return "clean contract review must check every map obligation exactly once";
  }
  if (checks.filter((name) => name === "BRIEF").length !== 1) {
    return "clean contract review must include exactly one BRIEF check";
  }
  return undefined;
}

export function isCleanContractResponse(response: string): boolean {
  return (
    response
      .split("\n")
      .filter((line) => line.trim() !== "")
      .at(-1) === "- VERDICT — No material findings."
  );
}
