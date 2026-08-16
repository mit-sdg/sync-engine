import { readFile } from "node:fs/promises";

const maximumBriefBytes = 8 * 1024;
const requiredSections = [
  "Objective",
  "Product decisions",
  "Visible success",
  "Expected refusals",
  "Assumptions",
  "Non-goals",
  "Open decisions",
] as const;

const decision = /^- \*\*D([1-9][0-9]*) — (.+) \((User|Assumption)\):\*\* (.+)$/;

export interface CheckedBrief {
  readonly bytes: number;
  readonly decisions: number;
  readonly openDecisions: boolean;
}

export class BriefCheckError extends Error {
  override readonly name = "BriefCheckError";
}

function substantive(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim() !== "" && !/^<!--.*-->$/.test(line.trim()));
}

export function checkBrief(source: string): CheckedBrief {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > maximumBriefBytes) {
    throw new BriefCheckError(`Brief is ${bytes} bytes; maximum is ${maximumBriefBytes}`);
  }
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.startsWith("---\n") || normalized.trim() === "---") {
    throw new BriefCheckError(`YAML frontmatter is not allowed`);
  }

  const lines = normalized.split("\n");
  const h1 = lines.flatMap((line, index) => (/^# (\S.*)$/.test(line) ? [index] : []));
  if (h1.length !== 1) throw new BriefCheckError(`Brief must contain exactly one nonempty H1`);

  const sections = lines.flatMap((line, index) => {
    const match = line.match(/^## (\S.*)$/);
    return match === null ? [] : [{ name: match[1]!, index }];
  });
  const actual = sections.map(({ name }) => name);
  if (
    actual.length !== requiredSections.length ||
    actual.some((name, index) => name !== requiredSections[index])
  ) {
    throw new BriefCheckError(`Brief H2 sections must be exactly: ${requiredSections.join(", ")}`);
  }
  if (h1[0]! > sections[0]!.index) throw new BriefCheckError(`Brief H1 must precede its sections`);

  const bodies = new Map<string, string[]>();
  for (let index = 0; index < sections.length; index += 1) {
    const current = sections[index]!;
    const end = sections[index + 1]?.index ?? lines.length;
    const body = lines.slice(current.index + 1, end);
    if (substantive(body).length === 0) {
      throw new BriefCheckError(`Brief section is empty: ${current.name}`);
    }
    bodies.set(current.name, body);
  }

  const decisionLines = substantive(bodies.get("Product decisions")!);
  const identifiers = new Set<string>();
  if (!(decisionLines.length === 1 && decisionLines[0] === "None.")) {
    for (const line of decisionLines) {
      const match = line.match(decision);
      if (match === null) throw new BriefCheckError(`Malformed product decision: ${line}`);
      const identifier = `D${match[1]}`;
      if (identifiers.has(identifier)) {
        throw new BriefCheckError(`Duplicate product decision identifier: ${identifier}`);
      }
      identifiers.add(identifier);
    }
  }

  const open = substantive(bodies.get("Open decisions")!);
  return {
    bytes,
    decisions: identifiers.size,
    openDecisions: !(open.length === 1 && open[0] === "None."),
  };
}

export async function checkBriefFile(path: string): Promise<CheckedBrief> {
  return checkBrief(await readFile(path, "utf8"));
}
