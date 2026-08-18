import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { workspaceDirectory } from "./workspace.ts";

export class AssignmentError extends Error {
  override readonly name = "AssignmentError";
}

/**
 * Files a role may never own, whatever an assignment says. Ownership is fixed by the role
 * prompts; an assignment that contradicts them sends a worker into another role's files.
 */
const forbiddenPaths: Readonly<Record<string, readonly { pattern: RegExp; owner: string }[]>> = {
  "concept-worker": [
    { pattern: /(^|\/)concepts\.ts$/, owner: "the application worker" },
    { pattern: /registr/i, owner: "the application worker" },
    { pattern: /(^|\/)assembly\.ts$/, owner: "the application worker" },
    { pattern: /(^|\/)compositions?\//, owner: "the application worker" },
    { pattern: /(^|\/)generated\.config\.ts$/, owner: "the application worker" },
    { pattern: /(^|\/)main\.ts$/, owner: "the application worker" },
    { pattern: /(^|\/)design\//, owner: "the designer" },
  ],
  "application-worker": [{ pattern: /(^|\/)design\//, owner: "the designer" }],
  "frontend-worker": [
    { pattern: /(^|\/)design\//, owner: "the designer" },
    { pattern: /(^|\/)concepts?\//, owner: "the concept worker" },
    { pattern: /(^|\/)assembly\.ts$/, owner: "the application worker" },
  ],
  "evidence-worker": [
    { pattern: /(^|\/)design\//, owner: "the designer" },
    { pattern: /(^|\/)src\//, owner: "the implementation workers" },
  ],
};

/** Commands that only make sense once the whole application exists. */
const applicationWideCommands = [
  "sync-engine verify",
  "sync-engine check",
  "sync-engine artifacts",
  "bun run check",
  "bun run start",
  "bun run generate",
];

const typeCheckPattern = /tsc\s+--noEmit|bun run typecheck/;
const storagePattern = /storage|persist|durab|in-memory|memory-only|restart/i;

export interface CheckedAssignment {
  readonly role: string;
  readonly bytes: number;
  readonly writePaths: readonly string[];
}

function writePaths(source: string): string[] {
  return [...source.matchAll(/^\s*[-*]\s+`([^`]+)`/gm)]
    .map((match) => match[1]!)
    .filter((path) => !path.includes(" "));
}

/**
 * Check the one artifact the coordinator still authors by hand. It cannot judge the prose,
 * but it can refuse an assignment that hands a role another role's files, that asks a
 * bounded role to run the whole application's checks, or that leaves a concept worker to
 * invent a storage guarantee.
 */
export function checkAssignment(role: string, source: string): CheckedAssignment {
  const bytes = Buffer.byteLength(source, "utf8");
  const paths = writePaths(source);
  const forbidden = forbiddenPaths[role] ?? [];
  for (const path of paths) {
    const match = forbidden.find((entry) => entry.pattern.test(path));
    if (match !== undefined) {
      throw new AssignmentError(`Assignment gives ${role} a path owned by ${match.owner}: ${path}`);
    }
  }

  if (role === "concept-worker") {
    const wide = applicationWideCommands.find((command) => source.includes(command));
    if (wide !== undefined) {
      throw new AssignmentError(
        `Assignment tells ${role} to run the application-wide command \`${wide}\`; give it only its own focused checks`,
      );
    }
    if (!typeCheckPattern.test(source)) {
      throw new AssignmentError(
        `Assignment gives ${role} no focused type check; without one the worker returns type errors as diagnostics`,
      );
    }
    if (!storagePattern.test(source)) {
      throw new AssignmentError(
        `Assignment states no storage guarantee; carry the brief's durability decision into ${role}'s assignment`,
      );
    }
  }

  return { role, bytes, writePaths: paths };
}

export async function checkAssignmentFile(path: string): Promise<CheckedAssignment> {
  const name = basename(path);
  const role = name.match(/-([a-z-]+)\.assignment\.md$/)?.[1];
  if (role === undefined) {
    throw new AssignmentError(
      `Assignment file names its role: expected ${workspaceDirectory}/<stamp>-<role>.assignment.md, found ${name}`,
    );
  }
  return checkAssignment(role, await readFile(path, "utf8"));
}

export function assignmentTemplate(role: string, designDigest: string): string {
  return `# ${role} assignment

Design digest: \`${designDigest}\`

## Objective

<One paragraph: what this role delivers for the brief.>

## Storage guarantee

<The brief's durability decision, stated as what survives restart. Concept State is not
storage; say what the implementation must do.>

## Allowed read paths

- \`<path>\`

## Allowed write paths

- \`<path>\`

## Commands

- \`<focused command this role runs itself>\`

## Return

Changed paths, check outcomes, and any blocker.
`;
}
