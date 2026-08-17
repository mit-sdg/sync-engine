import {
  parseSimpleStateForm as parsePackageSimpleStateForm,
  validateSimpleStateForm as validatePackageSimpleStateForm,
  type SsfDiagnostic,
  type SsfDocument,
  type SsfParseOptions,
  type SsfPosition,
  type SsfSpan,
} from "@ssf";
import type { DesignSourceLocation, MarkdownFence } from "./markdown-design-source.ts";

export type SimpleStateFormIssueCode = SsfDiagnostic["code"];

export interface SimpleStateFormIssue {
  readonly code: SimpleStateFormIssueCode;
  readonly message: string;
  readonly suggestion: string;
  readonly location: DesignSourceLocation;
  readonly span: SsfSpan;
}

export interface ParsedSimpleStateForm {
  readonly document: SsfDocument;
  readonly issues: readonly SimpleStateFormIssue[];
}

function sourceOf(fence: MarkdownFence): string {
  return fence.body.map(({ text }) => text).join("\n");
}

/** Map a package-local SSF position onto its containing Markdown source. */
export function simpleStateFormLocation(
  fence: MarkdownFence,
  position: SsfPosition,
): DesignSourceLocation {
  const line = fence.body[position.line - 1];
  return {
    source: fence.location.source,
    line: line?.number ?? fence.location.line + position.line,
    column: position.column,
  };
}

function adaptIssue(fence: MarkdownFence, diagnostic: SsfDiagnostic): SimpleStateFormIssue {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    suggestion: diagnostic.suggestion,
    location: simpleStateFormLocation(fence, diagnostic.span.start),
    span: diagnostic.span,
  };
}

/** Parse structural SSF and adapt package-local diagnostic spans to Markdown locations. */
export function parseSimpleStateForm(
  fence: MarkdownFence,
  options: SsfParseOptions = {},
): ParsedSimpleStateForm {
  const parsed = parsePackageSimpleStateForm(sourceOf(fence), options);
  return {
    document: parsed.document,
    issues: parsed.diagnostics.map((diagnostic) => adaptIssue(fence, diagnostic)),
  };
}

/** Validate deterministic, mechanically repairable SSF forms through the private parser. */
export function validateSimpleStateForm(fence: MarkdownFence): readonly SimpleStateFormIssue[] {
  return validatePackageSimpleStateForm(sourceOf(fence)).map((diagnostic) =>
    adaptIssue(fence, diagnostic),
  );
}
