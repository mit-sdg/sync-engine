export interface ErrorValue {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
}

function errorValue(error: unknown): ErrorValue {
  if (!(error instanceof Error)) {
    throw new Error(`Expected an Error, received ${String(error)}`);
  }
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" ? { code } : {}),
  };
}

export function thrownValue(action: () => unknown): ErrorValue {
  try {
    action();
  } catch (error) {
    return errorValue(error);
  }
  throw new Error("Expected action to throw");
}

export async function rejectedValue(action: PromiseLike<unknown>): Promise<ErrorValue> {
  try {
    await action;
  } catch (error) {
    return errorValue(error);
  }
  throw new Error("Expected promise to reject");
}

export type LabeledOutput = Readonly<Record<string, readonly string[]>>;

/** Parse the CLI's line-oriented `Label: value` protocol, retaining repeated labels. */
export function parseLabeledOutput(text: string): LabeledOutput {
  if (text === "") return {};
  if (text.at(-1) !== "\n") throw new Error("Labeled output must end with a newline");
  const values: Record<string, string[]> = {};
  let current: { label: string; index: number } | undefined;
  for (const line of text.slice(0, -1).split("\n")) {
    const match = /^([^:\n]+):(?: (.*))?$/.exec(line);
    if (match !== null) {
      const label = match[1]!;
      const list = (values[label] ??= []);
      list.push(match[2] ?? "");
      current = { label, index: list.length - 1 };
      continue;
    }
    if (current === undefined) throw new Error(`Unlabeled output line: ${line}`);
    values[current.label]![current.index] += `\n${line}`;
  }
  return values;
}

export interface MarkdownSection {
  readonly heading: string;
  readonly body: string;
}

/** Extract named Markdown sections by exact heading lines while preserving section bodies. */
export function markdownSections(
  markdown: string,
  level: number,
  names: readonly string[],
): readonly MarkdownSection[] {
  const accepted = new Set(names);
  const marker = "#".repeat(level);
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    const match = new RegExp(`^${marker} (.+)$`).exec(line);
    if (match !== null && accepted.has(match[1]!)) {
      current = { heading: match[1]!, lines: [] };
      sections.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return sections.map(({ heading, lines }) => {
    while (lines[0] === "") lines.shift();
    while (lines.at(-1) === "") lines.pop();
    return { heading, body: lines.join("\n") };
  });
}

export function sectionRecord(
  sections: readonly MarkdownSection[],
): Readonly<Record<string, string>> {
  return Object.fromEntries(sections.map(({ heading, body }) => [heading, body]));
}

export function promptSections(markdown: string): readonly MarkdownSection[] {
  return markdownSections(markdown, 1, [
    "Role and objective",
    "Capabilities",
    "Guidance",
    "Context",
    "Return shape",
  ]);
}

export function promptContext(
  markdown: string,
  headings: readonly string[],
): Readonly<Record<string, string>> {
  const context = promptSections(markdown).find(({ heading }) => heading === "Context");
  if (context === undefined) throw new Error("Prompt has no Context section");
  return sectionRecord(markdownSections(context.body, 2, headings));
}

export function retainedContext(displayName: string, _sha256: string, _bytes: number): string {
  return `**${displayName}**\n\nUnchanged from the prior same-agent context.`;
}
