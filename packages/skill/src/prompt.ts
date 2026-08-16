import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const promptRoles = [
  "designer",
  "critic",
  "concept-worker",
  "application-worker",
  "evidence-worker",
] as const;

export type PromptRole = (typeof promptRoles)[number];

const roleBudgets: Readonly<Record<PromptRole, number>> = {
  designer: 32 * 1024,
  critic: 48 * 1024,
  "concept-worker": 24 * 1024,
  "application-worker": 48 * 1024,
  "evidence-worker": 32 * 1024,
};

const directive = /^<!-- (include|input|input\?): ([^ ]+) -->$/;
const directivePrefix = /^<!-- (?:include|input\??)(?::|\s)/;

export interface PromptInput {
  readonly slot: string;
  readonly path: string;
}

export interface PromptSource {
  readonly kind: "template" | "include" | "input";
  readonly path: string;
  readonly displayName: string;
  readonly bytes: number;
}

export interface BuiltPrompt {
  readonly role: PromptRole;
  readonly content: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly budget: number;
  readonly budgetOverridden: boolean;
  readonly sources: readonly PromptSource[];
}

export class PromptBuildError extends Error {
  override readonly name = "PromptBuildError";
}

function normalizeMarkdown(source: string): string {
  return `${source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\n*$/, "")}\n`;
}

function byteLength(source: string): number {
  return Buffer.byteLength(source, "utf8");
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function displayName(path: string): string {
  if (isAbsolute(path)) return basename(path);
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  return normalized === "" ? basename(resolve(path)) : normalized;
}

function parseTemplate(source: string): ReadonlyMap<string, boolean> {
  const slots = new Map<string, boolean>();
  for (const line of source.split("\n")) {
    const match = line.match(directive);
    if (match === null) {
      if (directivePrefix.test(line)) throw new PromptBuildError(`Malformed directive: ${line}`);
      continue;
    }
    const [, kind, value] = match;
    if (kind === "include") continue;
    if (slots.has(value!)) throw new PromptBuildError(`Duplicate input directive: ${value}`);
    slots.set(value!, kind === "input");
  }
  return slots;
}

function rejectNestedDirectives(source: string, path: string): void {
  for (const line of source.split("\n")) {
    if (directive.test(line) || directivePrefix.test(line)) {
      throw new PromptBuildError(`Included file contains a directive: ${path}`);
    }
  }
}

export interface BuildPromptOptions {
  readonly role: string;
  readonly inputs: readonly PromptInput[];
  readonly promptRoot: string;
  readonly maxBytes?: number;
}

export async function buildPrompt(options: BuildPromptOptions): Promise<BuiltPrompt> {
  if (!promptRoles.includes(options.role as PromptRole)) {
    throw new PromptBuildError(`Unknown role: ${options.role}`);
  }
  const role = options.role as PromptRole;
  const root = resolve(options.promptRoot);
  const templatePath = resolve(root, "roles", `${role}.md`);
  if (!inside(root, templatePath)) throw new PromptBuildError(`Role template escapes prompt root`);

  const rawTemplate = await readFile(templatePath, "utf8");
  const template = normalizeMarkdown(rawTemplate);
  const slots = parseTemplate(template);
  const grouped = new Map<string, Array<PromptInput & { resolved: string; display: string }>>();
  const seenPaths = new Set<string>();
  const seenDisplayNames = new Set<string>();

  for (const input of options.inputs) {
    if (!slots.has(input.slot))
      throw new PromptBuildError(`Role ${role} has no input slot: ${input.slot}`);
    const resolvedPath = resolve(input.path);
    if (seenPaths.has(resolvedPath))
      throw new PromptBuildError(`Duplicate input file: ${input.path}`);
    seenPaths.add(resolvedPath);
    const display = displayName(input.path);
    if (display.includes("\n") || display.includes("\r") || display.includes("-->")) {
      throw new PromptBuildError(`Unsafe input display name: ${display}`);
    }
    if (seenDisplayNames.has(display))
      throw new PromptBuildError(`Duplicate input display name: ${display}`);
    seenDisplayNames.add(display);
    const values = grouped.get(input.slot) ?? [];
    values.push({ ...input, resolved: resolvedPath, display });
    grouped.set(input.slot, values);
  }

  for (const [slot, required] of slots) {
    if (required && (grouped.get(slot)?.length ?? 0) === 0) {
      throw new PromptBuildError(`Missing required input: ${slot}`);
    }
  }

  const sources: PromptSource[] = [
    {
      kind: "template",
      path: templatePath,
      displayName: `roles/${role}.md`,
      bytes: byteLength(template),
    },
  ];

  const renderedLines: string[] = [];
  for (const line of template.replace(/\n$/, "").split("\n")) {
    const match = line.match(directive);
    if (match === null) {
      renderedLines.push(line);
      continue;
    }
    const [, kind, value] = match as [string, "include" | "input" | "input?", string];
    if (kind === "include") {
      const includePath = resolve(dirname(templatePath), value);
      if (!inside(root, includePath)) {
        throw new PromptBuildError(`Include escapes prompt root: ${value}`);
      }
      const included = normalizeMarkdown(await readFile(includePath, "utf8"));
      rejectNestedDirectives(included, includePath);
      sources.push({
        kind: "include",
        path: includePath,
        displayName: relative(root, includePath).split(sep).join("/"),
        bytes: byteLength(included),
      });
      renderedLines.push(included.replace(/\n$/, ""));
      continue;
    }

    const values = [...(grouped.get(value) ?? [])].sort((left, right) =>
      left.display < right.display ? -1 : left.display > right.display ? 1 : 0,
    );
    const rendered: string[] = [];
    for (const input of values) {
      const content = normalizeMarkdown(await readFile(input.resolved, "utf8"));
      sources.push({
        kind: "input",
        path: input.resolved,
        displayName: input.display,
        bytes: byteLength(content),
      });
      rendered.push(`<!-- source: ${input.display} -->\n\n${content.replace(/\n$/, "")}`);
    }
    renderedLines.push(rendered.join("\n\n"));
  }

  const content = normalizeMarkdown(renderedLines.join("\n"));
  const bytes = byteLength(content);
  const budget = options.maxBytes ?? roleBudgets[role];
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new PromptBuildError(`Prompt budget must be a positive integer`);
  }
  if (bytes > budget) {
    const contributions = sources
      .map((source) => `${source.displayName}: ${source.bytes} bytes`)
      .join("; ");
    throw new PromptBuildError(
      `Prompt is ${bytes} bytes, exceeding the ${budget}-byte budget. Sources: ${contributions}`,
    );
  }

  return {
    role,
    content,
    bytes,
    sha256: createHash("sha256").update(content).digest("hex"),
    budget,
    budgetOverridden: options.maxBytes !== undefined,
    sources,
  };
}
