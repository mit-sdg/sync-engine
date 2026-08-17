import type { SourceLine, SsfOpaqueLine, SsfPosition, SsfSpan, SsfToken } from "./model.ts";

export function position(offset: number, line: number, column: number): SsfPosition {
  return { offset, line, column };
}

export function span(start: SsfPosition, end: SsfPosition): SsfSpan {
  return { start, end };
}

/** Tokenize all State text without discarding whitespace or source ranges. */
export function tokenizeSimpleStateForm(source: string): readonly SsfToken[] {
  const tokens: SsfToken[] = [];
  let offset = 0;
  let line = 1;
  let column = 1;
  while (offset < source.length) {
    const start = position(offset, line, column);
    const character = source[offset] ?? "";
    if (character === "\r" || character === "\n") {
      const length = character === "\r" && source[offset + 1] === "\n" ? 2 : 1;
      tokens.push({
        kind: "newline",
        text: source.slice(offset, offset + length),
        span: span(start, position(offset + length, line + 1, 1)),
      });
      offset += length;
      line += 1;
      column = 1;
      continue;
    }
    const whitespace = character === " " || character === "\t";
    let end = offset + 1;
    while (end < source.length) {
      const candidate = source[end] ?? "";
      if (candidate === "\r" || candidate === "\n") break;
      if ((candidate === " " || candidate === "\t") !== whitespace) break;
      end += 1;
    }
    tokens.push({
      kind: whitespace ? "whitespace" : "word",
      text: source.slice(offset, end),
      span: span(start, position(end, line, column + end - offset)),
    });
    column += end - offset;
    offset = end;
  }
  return tokens;
}

export function sourceLines(source: string, tokens: readonly SsfToken[]): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  let number = 1;
  for (const token of tokens) {
    if (token.kind !== "newline") continue;
    const end = token.span.start.offset;
    lines.push({
      text: source.slice(start, end),
      line: number,
      start,
      end,
      tokens: tokens.filter(
        (candidate) =>
          candidate.kind === "word" &&
          candidate.span.start.offset >= start &&
          candidate.span.end.offset <= end,
      ),
    });
    start = token.span.end.offset;
    number += 1;
  }
  if (start < source.length || source.length === 0 || tokens.at(-1)?.kind !== "newline") {
    lines.push({
      text: source.slice(start),
      line: number,
      start,
      end: source.length,
      tokens: tokens.filter(
        (candidate) => candidate.kind === "word" && candidate.span.start.offset >= start,
      ),
    });
  }
  return lines;
}

export function lineSpan(line: SourceLine): SsfSpan {
  return span(
    position(line.start, line.line, 1),
    position(line.end, line.line, line.text.length + 1),
  );
}

export function opaqueLine(line: SourceLine): SsfOpaqueLine {
  return { kind: "opaque", text: line.text, span: lineSpan(line) };
}

export function words(line: SourceLine): readonly string[] {
  return line.tokens.map(({ text }) => text);
}
