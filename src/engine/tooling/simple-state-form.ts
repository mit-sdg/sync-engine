import type {
  DesignSourceLine,
  DesignSourceLocation,
  MarkdownFence,
} from "./markdown-design-source.ts";

export type SimpleStateFormIssueCode =
  | "SSF_ARTICLE"
  | "SSF_MISPLACED_OPTIONAL"
  | "SSF_MISSING_WITH"
  | "SSF_NEAR_MISS_KEYWORD"
  | "SSF_OPTIONAL_COLLECTION";

export interface SimpleStateFormIssue {
  readonly code: SimpleStateFormIssueCode;
  readonly message: string;
  readonly suggestion: string;
  readonly location: DesignSourceLocation;
}

interface Token {
  readonly text: string;
  readonly index: number;
}

interface Declaration {
  readonly line: DesignSourceLine;
  readonly tokens: readonly Token[];
  readonly structuralIndex: number;
  readonly structural: string;
  readonly canonicalStructural: "set" | "seq" | "element";
  readonly hasWith: boolean;
  readonly body: readonly DesignSourceLine[];
}

const CANONICAL_STRUCTURAL = new Set(["set", "seq", "element"]);
const NEAR_MISS_STRUCTURAL = new Map<string, "seq" | "element">([
  ["array", "seq"],
  ["list", "seq"],
  ["sequence", "seq"],
  ["sequences", "seq"],
  ["singleton", "element"],
]);
const TYPE_NAME = /^[A-Z][A-Za-z0-9_]*$/;

function tokensOf(text: string): readonly Token[] {
  return [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    index: match.index,
  }));
}

function at(fence: MarkdownFence, line: DesignSourceLine, column: number): DesignSourceLocation {
  return { source: fence.location.source, line: line.number, column };
}

function articleForStructural(structural: "set" | "seq" | "element"): "a" | "an" {
  return structural === "element" ? "an" : "a";
}

function declarationOf(
  line: DesignSourceLine,
  body: readonly DesignSourceLine[],
): Declaration | undefined {
  if (/^[ \t]/.test(line.text)) return undefined;
  const tokens = tokensOf(line.text);
  if (tokens[0]?.text !== "a" && tokens[0]?.text !== "an") return undefined;

  const structuralIndex = [1, 2].find((index) => {
    const token = tokens[index]?.text;
    return (
      token !== undefined && (CANONICAL_STRUCTURAL.has(token) || NEAR_MISS_STRUCTURAL.has(token))
    );
  });
  if (structuralIndex === undefined) return undefined;

  const structural = tokens[structuralIndex].text;
  const canonicalStructural = CANONICAL_STRUCTURAL.has(structural)
    ? (structural as "set" | "seq" | "element")
    : NEAR_MISS_STRUCTURAL.get(structural);
  if (canonicalStructural === undefined) return undefined;

  let typeIndex = structuralIndex + 1;
  if (tokens[typeIndex]?.text === "of") typeIndex += 1;
  if (!TYPE_NAME.test(tokens[typeIndex]?.text ?? "")) return undefined;

  return {
    line,
    tokens,
    structuralIndex,
    structural,
    canonicalStructural,
    hasWith: tokens.slice(typeIndex + 1).some(({ text }) => text === "with"),
    body,
  };
}

function declarationsOf(fence: MarkdownFence): readonly Declaration[] {
  const groups: { signature: DesignSourceLine; body: DesignSourceLine[] }[] = [];
  for (const line of fence.body) {
    if (line.text.trim() === "") {
      groups.at(-1)?.body.push(line);
    } else if (/^[ \t]/.test(line.text)) {
      groups.at(-1)?.body.push(line);
    } else {
      groups.push({ signature: line, body: [] });
    }
  }
  return groups.flatMap(({ signature, body }) => {
    const declaration = declarationOf(signature, body);
    return declaration === undefined ? [] : [declaration];
  });
}

function correctedTokens(
  tokens: readonly Token[],
  replacements: ReadonlyMap<number, string>,
): string {
  return tokens.map(({ text }, index) => replacements.get(index) ?? text).join(" ");
}

function declarationIssues(fence: MarkdownFence, declaration: Declaration): SimpleStateFormIssue[] {
  const issues: SimpleStateFormIssue[] = [];
  const { line, tokens, structuralIndex, structural, canonicalStructural } = declaration;
  const hasField = declaration.body.some((candidate) => {
    const tokens = tokensOf(candidate.text);
    return tokens[0]?.text === "a" || tokens[0]?.text === "an";
  });
  const replacements = new Map<number, string>();
  if (structural !== canonicalStructural) replacements.set(structuralIndex, canonicalStructural);
  if (structuralIndex === 1) replacements.set(0, articleForStructural(canonicalStructural));
  const canonicalLine = `${correctedTokens(tokens, replacements)}${
    hasField && !declaration.hasWith ? " with" : ""
  }`;

  if (structural !== canonicalStructural) {
    issues.push({
      code: "SSF_NEAR_MISS_KEYWORD",
      message: `Use the SSF keyword \`${canonicalStructural}\` instead of \`${structural}\`.`,
      suggestion: canonicalLine,
      location: at(fence, line, tokens[structuralIndex].index + 1),
    });
  } else if (structuralIndex === 1) {
    const expected = articleForStructural(canonicalStructural);
    if (tokens[0].text !== expected) {
      issues.push({
        code: "SSF_ARTICLE",
        message: `Use \`${expected}\` before \`${canonicalStructural}\`.`,
        suggestion: canonicalLine,
        location: at(fence, line, tokens[0].index + 1),
      });
    }
  }

  if (hasField && !declaration.hasWith) {
    issues.push({
      code: "SSF_MISSING_WITH",
      message: "A declaration with indented fields must include `with`.",
      suggestion: canonicalLine,
      location: at(fence, line, line.text.length + 1),
    });
  }
  return issues;
}

function fieldIssues(
  fence: MarkdownFence,
  line: DesignSourceLine,
): readonly SimpleStateFormIssue[] {
  if (!/^[ \t]/.test(line.text)) return [];
  const tokens = tokensOf(line.text);
  if (tokens[0]?.text !== "a" && tokens[0]?.text !== "an") return [];

  const optionalIndex = tokens.findIndex(({ text }) => text === "optional");
  if (optionalIndex < 0) return [];
  const collectionIndex = tokens.findIndex(
    ({ text }, index) => (text === "set" || text === "seq") && tokens[index + 1]?.text === "of",
  );
  if (collectionIndex >= 0) {
    return [
      {
        code: "SSF_OPTIONAL_COLLECTION",
        message: "SSF collections are never optional; an empty collection represents absence.",
        suggestion: "Remove `optional` from this field.",
        location: at(fence, line, tokens[optionalIndex].index + 1),
      },
    ];
  }
  if (optionalIndex !== 1) {
    const withoutOptional = tokens
      .filter((_, index) => index !== optionalIndex)
      .map(({ text }) => text);
    withoutOptional[0] = "an";
    withoutOptional.splice(1, 0, "optional");
    return [
      {
        code: "SSF_MISPLACED_OPTIONAL",
        message: "The `optional` modifier must immediately follow the article.",
        suggestion: withoutOptional.join(" "),
        location: at(fence, line, tokens[optionalIndex].index + 1),
      },
    ];
  }
  if (tokens[0].text === "a") {
    return [
      {
        code: "SSF_ARTICLE",
        message: "Use `an` before `optional`.",
        suggestion: correctedTokens(tokens, new Map([[0, "an"]])),
        location: at(fence, line, tokens[0].index + 1),
      },
    ];
  }
  return [];
}

/**
 * Validate only deterministic, mechanically repairable SSF forms. Unrecognized
 * lines remain opaque so this checker does not define a complete State dialect.
 */
export function validateSimpleStateForm(fence: MarkdownFence): readonly SimpleStateFormIssue[] {
  const issues: SimpleStateFormIssue[] = [];
  for (const declaration of declarationsOf(fence)) {
    issues.push(...declarationIssues(fence, declaration));
    for (const line of declaration.body) issues.push(...fieldIssues(fence, line));
  }
  return issues;
}
