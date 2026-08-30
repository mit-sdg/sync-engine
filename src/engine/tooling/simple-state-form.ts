import {
  parseSimpleStateForm as parsePackageSimpleStateForm,
  validateSimpleStateForm as validatePackageSimpleStateForm,
  type SsfDiagnostic,
  type SsfDocument,
  type SsfParseOptions,
  type SsfPosition,
  type SsfSpan,
} from "@ssf";
import type { SpecificationExternalTypeIR, SpecificationLocalTypeIR } from "@engine/reads/ir";
import type { DesignSourceLocation, MarkdownFence } from "./markdown-design-source.ts";

export type SimpleStateFormIssueCode = SsfDiagnostic["code"];
export type SimpleStateFormOptions = Omit<SsfParseOptions, "externalTypes" | "localTypes"> & {
  readonly externalTypes?: readonly SpecificationExternalTypeIR[];
  readonly localTypes?: readonly SpecificationLocalTypeIR[];
};

interface SimpleStateFormIssueDetail {
  readonly severity: SsfDiagnostic["severity"];
  readonly code: SimpleStateFormIssueCode;
  readonly message: string;
  readonly suggestion: string;
  readonly location: DesignSourceLocation;
}

export type SimpleStateFormIssue = SimpleStateFormIssueDetail &
  (
    | { readonly span: SsfSpan; readonly externalType?: never }
    | { readonly externalType: string; readonly span?: never }
  );

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

function packageOptions(options: SimpleStateFormOptions): SsfParseOptions {
  return {
    ...(options.externalTypes === undefined
      ? {}
      : { externalTypes: options.externalTypes.map(({ name }) => name) }),
    ...(options.evidenceTypeNames === undefined
      ? {}
      : { evidenceTypeNames: options.evidenceTypeNames }),
    ...(options.localTypes === undefined
      ? {}
      : {
          localTypes: options.localTypes.map((type) => ({
            name: type.name,
            ...(type.kind === "enumeration" ? { values: type.values } : {}),
          })),
        }),
  };
}

function adaptIssue(
  fence: MarkdownFence,
  options: SimpleStateFormOptions,
  diagnostic: SsfDiagnostic,
): SimpleStateFormIssue {
  const detail = {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    suggestion: diagnostic.suggestion,
  };
  if (diagnostic.span !== undefined)
    return {
      ...detail,
      location: simpleStateFormLocation(fence, diagnostic.span.start),
      span: diagnostic.span,
    };
  const externalType = diagnostic.externalType;
  const external = options.externalTypes?.find(({ name }) => name === externalType);
  if (external === undefined)
    throw new Error(`SSF diagnostic names unknown external type ${JSON.stringify(externalType)}.`);
  return {
    ...detail,
    location: { source: fence.location.source, ...external.location },
    externalType,
  };
}

/** Parse structural SSF and adapt package-local diagnostic spans to Markdown locations. */
export function parseSimpleStateForm(
  fence: MarkdownFence,
  options: SimpleStateFormOptions = {},
): ParsedSimpleStateForm {
  const parsed = parsePackageSimpleStateForm(sourceOf(fence), packageOptions(options));
  return {
    document: parsed.document,
    issues: parsed.diagnostics.map((diagnostic) => adaptIssue(fence, options, diagnostic)),
  };
}

/** Validate deterministic, mechanically repairable SSF forms through the private parser. */
export function validateSimpleStateForm(
  fence: MarkdownFence,
  options: SimpleStateFormOptions = {},
): readonly SimpleStateFormIssue[] {
  return validatePackageSimpleStateForm(sourceOf(fence), packageOptions(options)).map(
    (diagnostic) => adaptIssue(fence, options, diagnostic),
  );
}
