import { createHash } from "node:crypto";

/** A one-based position in an authored Markdown file. */
export interface DesignSourceLocation {
  source: string;
  line: number;
  column: number;
}

export interface DesignSourceLine {
  text: string;
  number: number;
}

export interface MarkdownFence {
  info: string;
  location: DesignSourceLocation;
  body: readonly DesignSourceLine[];
}

export interface MarkdownHeading {
  level: number;
  text: string;
  location: DesignSourceLocation;
}

export interface ScannedMarkdown {
  source: string;
  content: string;
  digest: string;
  lines: readonly DesignSourceLine[];
  headings: readonly MarkdownHeading[];
  fences: readonly MarkdownFence[];
  proseLineNumbers: ReadonlySet<number>;
}

interface FenceMarker {
  character: "`" | "~";
  length: number;
  info: string;
  indentation: number;
}

/** Canonicalize text-file conventions without discarding authored whitespace. */
export function normalizeDesignContent(markdown: string): string {
  const withoutBom = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const newlines = withoutBom.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return newlines.endsWith("\n") ? newlines : `${newlines}\n`;
}

/** Digest the normalized complete document, including ordinary prose. */
export function designContentDigest(markdown: string): string {
  const digest = createHash("sha256")
    .update(normalizeDesignContent(markdown), "utf8")
    .digest("hex");
  return `sha256-${digest}`;
}

function openingMarker(text: string): FenceMarker | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(text);
  if (match === null || (match[2][0] === "`" && match[3].includes("`"))) return undefined;
  return {
    character: match[2][0] as "`" | "~",
    length: match[2].length,
    info: match[3].trim(),
    indentation: match[1].length,
  };
}

function closes(text: string, marker: FenceMarker): boolean {
  const expression = marker.character === "`" ? /^( {0,3})(`{3,})\s*$/ : /^( {0,3})(~{3,})\s*$/;
  const match = expression.exec(text);
  return match !== null && match[2].length >= marker.length;
}

function location(source: string, line: number, column = 1): DesignSourceLocation {
  return { source, line, column };
}

function headingText(text: string): string {
  if (/^#+\s*$/.test(text)) return "";
  return text.replace(/\s+#+\s*$/, "").trim();
}

/**
 * Scan only the Markdown structure needed by authored design files. Fenced
 * regions are identified once so heading, link, and declaration parsing share
 * the same view of source lines.
 */
export function scanDesignMarkdown(markdown: string, source = "<design>"): ScannedMarkdown {
  if (typeof markdown !== "string") throw new TypeError("design markdown must be a string.");
  const content = normalizeDesignContent(markdown);
  const rawLines = content.slice(0, -1).split("\n");
  const lines = rawLines.map((text, index) => ({ text, number: index + 1 }));
  const headings: MarkdownHeading[] = [];
  const fences: MarkdownFence[] = [];
  const proseLineNumbers = new Set(lines.map(({ number }) => number));
  let open:
    | { marker: FenceMarker; opening: DesignSourceLine; body: DesignSourceLine[] }
    | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open !== undefined) {
      proseLineNumbers.delete(line.number);
      if (closes(line.text, open.marker)) {
        fences.push({
          info: open.marker.info,
          location: location(source, open.opening.number, open.marker.indentation + 1),
          body: open.body,
        });
        open = undefined;
      } else {
        const removable = Math.min(open.marker.indentation, /^ */.exec(line.text)?.[0].length ?? 0);
        open.body.push({ text: line.text.slice(removable), number: line.number });
      }
      continue;
    }

    const marker = openingMarker(line.text);
    if (marker !== undefined) {
      proseLineNumbers.delete(line.number);
      open = { marker, opening: line, body: [] };
      continue;
    }

    const atx = /^( {0,3})(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line.text);
    if (atx !== null) {
      headings.push({
        level: atx[2].length,
        text: headingText(atx[3] ?? ""),
        location: location(source, line.number, atx[1].length + 1),
      });
      continue;
    }
    const underline = /^( {0,3})(=+|-+)\s*$/.exec(line.text);
    const previous = lines[index - 1];
    if (
      underline !== null &&
      previous !== undefined &&
      proseLineNumbers.has(previous.number) &&
      previous.text.trim() !== ""
    ) {
      headings.push({
        level: underline[2][0] === "=" ? 1 : 2,
        text: previous.text.trim(),
        location: location(
          source,
          previous.number,
          (previous.text.match(/^ */)?.[0].length ?? 0) + 1,
        ),
      });
    }
  }

  if (open !== undefined) {
    throw new Error(`${source}:${open.opening.number}: fenced code block is not closed.`);
  }
  return {
    source,
    content,
    digest: designContentDigest(content),
    lines,
    headings,
    fences,
    proseLineNumbers,
  };
}

export function exactlyOneH1(markdown: ScannedMarkdown): MarkdownHeading {
  const headings = markdown.headings.filter(({ level }) => level === 1);
  if (headings.length !== 1) {
    throw new Error(`${markdown.source}: application design document must contain exactly one H1.`);
  }
  if (headings[0].text === "") {
    throw new Error(`${markdown.source}:${headings[0].location.line}: the H1 must be nonempty.`);
  }
  return headings[0];
}

/** Group left-margin declarations with their indented bodies. */
export function declarationGroups(
  fence: MarkdownFence,
): readonly { signature: DesignSourceLine; body: readonly DesignSourceLine[] }[] {
  const groups: { signature: DesignSourceLine; body: DesignSourceLine[] }[] = [];
  for (const line of fence.body) {
    if (line.text.trim() === "") {
      groups.at(-1)?.body.push(line);
    } else if (/^[ \t]/.test(line.text)) {
      const group = groups.at(-1);
      if (group === undefined) {
        throw new Error(
          `${fence.location.source}:${line.number}: declaration body precedes a signature.`,
        );
      }
      group.body.push(line);
    } else {
      groups.push({ signature: line, body: [] });
    }
  }
  return groups;
}

export function indentedBody(lines: readonly DesignSourceLine[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text.trim() === "") start += 1;
  while (end > start && lines[end - 1].text.trim() === "") end -= 1;
  if (start === end) return "";
  const selected = lines.slice(start, end);
  const indentation = Math.min(
    ...selected
      .filter(({ text }) => text.trim() !== "")
      .map(({ text }) => /^[ \t]*/.exec(text)?.[0].length ?? 0),
  );
  return selected.map(({ text }) => text.slice(indentation).trimEnd()).join("\n");
}
