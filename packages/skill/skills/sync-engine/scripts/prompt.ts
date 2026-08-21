import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { designScope, requireDesignDigest } from "./design.ts";

export const promptRoles = [
  "designer",
  "critic",
  "concept-worker",
  "application-worker",
  "frontend-worker",
  "evidence-worker",
] as const;

export type PromptRole = (typeof promptRoles)[number];
export type PromptMode = "map" | "contract";
export type ToolPolicy =
  | "prompt-read-only"
  | "decomposition-write-only"
  | "design-and-syntax-only"
  | "assignment-only";

export function toolPolicy(role: PromptRole, mode?: PromptMode): ToolPolicy {
  if (role === "critic") return "prompt-read-only";
  if (role === "designer") {
    return mode === "contract" ? "design-and-syntax-only" : "decomposition-write-only";
  }
  return "assignment-only";
}

const defaultModes: Partial<Record<PromptRole, PromptMode>> = {
  designer: "map",
  critic: "contract",
};

const roleBudgets: Readonly<Record<PromptRole, number>> = {
  designer: 32 * 1024,
  critic: 48 * 1024,
  "concept-worker": 24 * 1024,
  "application-worker": 48 * 1024,
  "frontend-worker": 48 * 1024,
  "evidence-worker": 32 * 1024,
};

const directive = /^<!-- (include|input|input\?|bind|bind\?): ([^ ]+) -->$/;
const directivePrefix = /^<!-- (?:include|input\??|bind\??)(?::|\s)/;

export interface PromptInput {
  readonly slot: string;
  readonly path: string;
}

export interface PromptSource {
  readonly kind: "template" | "include" | "input" | "binding";
  readonly path: string;
  readonly displayName: string;
  readonly bytes: number;
}

export interface BuiltPrompt {
  readonly role: PromptRole;
  readonly mode?: PromptMode;
  readonly toolPolicy: ToolPolicy;
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

/** Every slot a role accepts, required ones first, optional ones marked. */
function describeSlots(slots: ReadonlyMap<string, boolean>): string {
  const names = [...slots].sort(([, a], [, b]) => Number(b) - Number(a));
  return names.map(([name, required]) => (required ? name : `${name} (optional)`)).join(", ");
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
    slots.set(value!, kind === "input" || kind === "bind");
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

export interface PromptInlineInput {
  readonly slot: string;
  readonly displayName: string;
  readonly content: string;
}

export interface BuildPromptOptions {
  readonly role: string;
  readonly mode?: PromptMode;
  readonly inputs: readonly PromptInput[];
  readonly inlineInputs?: readonly PromptInlineInput[];
  /** A user-overridden fresh continuation receives bound source bytes in full. */
  readonly expandBindings?: boolean;
  readonly promptRoot: string;
  readonly maxBytes?: number;
  readonly designRoot?: string;
  readonly expectedDesignDigest?: string;
}

export async function buildPrompt(options: BuildPromptOptions): Promise<BuiltPrompt> {
  if (!promptRoles.includes(options.role as PromptRole)) {
    throw new PromptBuildError(
      `Unknown role: ${options.role}; roles are ${promptRoles.join(", ")}`,
    );
  }
  const role = options.role as PromptRole;
  const defaultMode = defaultModes[role];
  if (defaultMode === undefined && options.mode !== undefined) {
    throw new PromptBuildError(`Role ${role} has no prompt modes`);
  }
  const mode = options.mode ?? defaultMode;
  const downstream = [
    "concept-worker",
    "application-worker",
    "frontend-worker",
    "evidence-worker",
  ].includes(role);
  if (
    downstream &&
    (options.designRoot === undefined || options.expectedDesignDigest === undefined)
  ) {
    throw new PromptBuildError(
      `Role ${role} requires designRoot and expectedDesignDigest from closed review`,
    );
  }
  if (
    !downstream &&
    (options.designRoot !== undefined || options.expectedDesignDigest !== undefined)
  ) {
    throw new PromptBuildError(`Role ${role} does not accept a closed design digest`);
  }
  if (downstream) {
    await requireDesignDigest(
      options.designRoot!,
      options.expectedDesignDigest!,
      designScope(role),
    );
  }
  const root = resolve(options.promptRoot);
  const templateName = mode === undefined || mode === defaultMode ? role : `${role}-${mode}`;
  const templatePath = resolve(root, "roles", `${templateName}.md`);
  if (!inside(root, templatePath)) throw new PromptBuildError(`Role template escapes prompt root`);

  const rawTemplate = await readFile(templatePath, "utf8");
  const template = normalizeMarkdown(rawTemplate);
  const slots = parseTemplate(template);
  type Material = {
    readonly slot: string;
    readonly resolved?: string;
    readonly display: string;
    readonly content?: string;
  };
  const grouped = new Map<string, Material[]>();
  const seenPaths = new Set<string>();
  const seenDisplayNames = new Set<string>();

  for (const input of options.inputs) {
    if (!slots.has(input.slot)) {
      throw new PromptBuildError(
        `Role ${role} has no input slot: ${input.slot}; its slots are ${describeSlots(slots)}`,
      );
    }
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
    values.push({ slot: input.slot, resolved: resolvedPath, display });
    grouped.set(input.slot, values);
  }
  for (const input of options.inlineInputs ?? []) {
    if (!slots.has(input.slot)) {
      throw new PromptBuildError(
        `Role ${role} has no input slot: ${input.slot}; its slots are ${describeSlots(slots)}`,
      );
    }
    if (seenDisplayNames.has(input.displayName)) {
      throw new PromptBuildError(`Duplicate input display name: ${input.displayName}`);
    }
    seenDisplayNames.add(input.displayName);
    const values = grouped.get(input.slot) ?? [];
    values.push({ slot: input.slot, display: input.displayName, content: input.content });
    grouped.set(input.slot, values);
  }

  for (const [slot, required] of slots) {
    if (required && (grouped.get(slot)?.length ?? 0) === 0) {
      throw new PromptBuildError(
        `Missing required input: ${slot}; role ${role} takes ${describeSlots(slots)}`,
      );
    }
  }

  const sources: PromptSource[] = [
    {
      kind: "template",
      path: templatePath,
      displayName: `roles/${templateName}.md`,
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
    const [, kind, value] = match as [
      string,
      "include" | "input" | "input?" | "bind" | "bind?",
      string,
    ];
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
      const content = normalizeMarkdown(input.content ?? (await readFile(input.resolved!, "utf8")));
      if ((kind === "bind" || kind === "bind?") && options.expandBindings !== true) {
        const binding = `<!-- bound: ${input.display}; sha256 ${createHash("sha256").update(content).digest("hex")}; ${byteLength(content)} source bytes retained in the continuing agent context -->`;
        sources.push({
          kind: "binding",
          path: input.resolved ?? `<inline:${input.display}>`,
          displayName: input.display,
          bytes: byteLength(binding),
        });
        rendered.push(binding);
        continue;
      }
      sources.push({
        kind: "input",
        path: input.resolved ?? `<inline:${input.display}>`,
        displayName: input.display,
        bytes: byteLength(content),
      });
      rendered.push(`<!-- source: ${input.display} -->\n\n${content.replace(/\n$/, "")}`);
    }
    renderedLines.push(rendered.join("\n\n"));
  }

  const content = normalizeMarkdown(renderedLines.join("\n"));
  if (downstream) {
    await requireDesignDigest(
      options.designRoot!,
      options.expectedDesignDigest!,
      designScope(role),
    );
  }
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
    ...(mode === undefined ? {} : { mode }),
    toolPolicy: toolPolicy(role, mode),
    content,
    bytes,
    sha256: createHash("sha256").update(content).digest("hex"),
    budget,
    budgetOverridden: options.maxBytes !== undefined,
    sources,
  };
}
