import type { SourceLine, SsfPosition, SsfRuleLine, SsfSpan, SsfToken } from "./model.ts";

export function position(offset: number, line: number, column: number): SsfPosition {
  return { offset, line, column };
}

export function span(start: SsfPosition, end: SsfPosition): SsfSpan {
  return { start, end };
}

const isInlineWhitespace = (character: string): boolean =>
  character !== "\r" && character !== "\n" && /\s/u.test(character);

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
    const whitespace = isInlineWhitespace(character);
    let end = offset + 1;
    while (end < source.length) {
      const candidate = source[end] ?? "";
      if (candidate === "\r" || candidate === "\n") break;
      if (isInlineWhitespace(candidate) !== whitespace) break;
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
  let lineTokens: SsfToken[] = [];
  const push = (end: number): void => {
    lines.push({ text: source.slice(start, end), line: number, start, end, tokens: lineTokens });
    lineTokens = [];
  };
  for (const token of tokens) {
    if (token.kind === "word") lineTokens.push(token);
    else if (token.kind === "newline") {
      push(token.span.start.offset);
      start = token.span.end.offset;
      number += 1;
    }
  }
  if (source === "" || !/[\r\n]$/u.test(source)) push(source.length);
  return lines;
}

export function lineSpan(line: SourceLine): SsfSpan {
  return span(
    position(line.start, line.line, 1),
    position(line.end, line.line, line.text.length + 1),
  );
}

export function ruleLine(line: SourceLine): SsfRuleLine {
  return { kind: "rule", text: line.text, span: lineSpan(line) };
}

export function words(line: SourceLine): readonly string[] {
  return line.tokens.map(({ text }) => text);
}
