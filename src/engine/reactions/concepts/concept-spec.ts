/** Parse the complete version-1 authored contract of one concept definition. */

import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  ConceptSpecificationIR,
  SpecificationActionIR,
  SpecificationExternalTypeIR,
  SpecificationFieldIR,
  SpecificationLocationIR,
  SpecificationQueryIR,
  SpecificationRefusalIR,
  SpecificationResultIR,
  SpecificationStateIR,
  SpecificationTypeIR,
} from "@engine/reads/ir";
import type { QueryPromise } from "@engine/reads/query-metadata";
import { isDesignIdentifier } from "@engine/utils/design-identifiers";

export type SpecLocation = SpecificationLocationIR;
export type SpecType = SpecificationTypeIR;
export type SpecField = SpecificationFieldIR;
export type SpecResult = SpecificationResultIR;
export type SpecRefusal = SpecificationRefusalIR;
export type SpecAction = SpecificationActionIR;
export type SpecQuery = SpecificationQueryIR;
export type SpecExternalType = SpecificationExternalTypeIR;
export type SpecState = SpecificationStateIR;
export type ConceptSpec = ConceptSpecificationIR;

export type ConceptSpecDiagnosticCode =
  | "CONCEPT_SPEC_INVALID_INPUT"
  | "CONCEPT_SPEC_APPLICATION_CONSTRUCT"
  | "CONCEPT_SPEC_DOCUMENT_STRUCTURE"
  | "CONCEPT_SPEC_PROSE_SECTION"
  | "CONCEPT_SPEC_FENCE"
  | "CONCEPT_SPEC_DECLARATION"
  | "CONCEPT_SPEC_SIGNATURE"
  | "CONCEPT_SPEC_DUPLICATE_DECLARATION"
  | "CONCEPT_SPEC_ACTION_BRANCH";

interface ConceptSpecDiagnosticDetail {
  readonly code: ConceptSpecDiagnosticCode;
  readonly message: string;
}

/** A parser diagnostic anchored at the one source position the parser can establish exactly. */
export type ConceptSpecDiagnostic = ConceptSpecDiagnosticDetail & {
  readonly location: SpecLocation;
};

/** Render one parser diagnostic in the list form used by registration errors. */
export function formatConceptSpecDiagnostic({
  code,
  message,
  location,
}: ConceptSpecDiagnostic): string {
  return `- line ${location.line}, column ${location.column}: [${code}] ${message}`;
}

/** A complete specification is available only when parsing reported no diagnostics. */
export type ConceptSpecParseResult =
  | { readonly specification: ConceptSpec; readonly diagnostics: readonly [] }
  | { readonly specification: undefined; readonly diagnostics: readonly ConceptSpecDiagnostic[] };

const SECTION_NAMES = ["Purpose", "Principle", "Types", "State", "Actions", "Queries"] as const;
type SectionName = (typeof SECTION_NAMES)[number];
const PROMISES = new Set<string>(["one", "optional", "many"]);
const REFUSE = /^refuse\s+(\S+)\s+("(?:[^"\\]|\\.)*")$/;
const RETURN = /^return(?:\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*))?$/;

interface SourceLine {
  readonly text: string;
  readonly number: number;
}

interface DocumentSection {
  readonly heading: SectionName;
  readonly location: SpecLocation;
  readonly lines: readonly SourceLine[];
}

interface ParsedDocument {
  readonly definitionName: string | undefined;
  readonly sections: Partial<Record<SectionName, DocumentSection>>;
}

interface DeclarationGroup {
  readonly signature: SourceLine;
  readonly body: SourceLine[];
}

interface FenceMarker {
  readonly character: "`" | "~";
  readonly length: number;
  readonly info: string;
  readonly indentation: number;
}

function at(line: SourceLine, column = 1): SpecLocation {
  return { line: line.number, column };
}

type ConceptSpecDiagnosticReporter = (
  code: ConceptSpecDiagnosticCode,
  what: string,
  location?: SpecLocation,
) => void;

class ConceptSpecDiagnosticCollector {
  readonly diagnostics: ConceptSpecDiagnostic[] = [];

  readonly report: ConceptSpecDiagnosticReporter = (
    code,
    what,
    location = { line: 1, column: 1 },
  ): void => {
    this.diagnostics.push({
      code,
      message: what.endsWith(".") ? what : `${what}.`,
      location,
    });
  };
}

function markerOf(line: string): FenceMarker | undefined {
  const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null || (match[2][0] === "`" && match[3].includes("`"))) return undefined;
  return {
    character: match[2][0] as "`" | "~",
    length: match[2].length,
    info: match[3].trim(),
    indentation: match[1].length,
  };
}

function closes(marker: FenceMarker, open: FenceMarker): boolean {
  return marker.character === open.character && marker.length >= open.length && marker.info === "";
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

interface Heading {
  readonly level: HeadingLevel;
  readonly name: string;
  readonly line: SourceLine;
}

function headingOf(line: string, level: HeadingLevel): string | undefined {
  const hashes = "#".repeat(level);
  const match = new RegExp(`^\\s{0,3}${hashes}(?!#)\\s+(.+?)\\s*#*\\s*$`).exec(line);
  return match?.[1];
}

interface MarkdownNode {
  readonly type: string;
  readonly url?: unknown;
  readonly lang?: unknown;
  readonly children?: readonly MarkdownNode[];
  readonly position?: { readonly start: { readonly line: number; readonly column: number } };
}

/** Reject application-only constructs using Markdown structure rather than source-like text. */
function rejectApplicationDesign(
  markdown: string,
  lines: readonly SourceLine[],
  report: ConceptSpecDiagnosticReporter,
): void {
  const visit = (node: MarkdownNode): void => {
    if (
      (node.type === "link" || node.type === "definition") &&
      typeof node.url === "string" &&
      /^(?:reaction|view|former|computation):/.test(node.url)
    ) {
      const start = node.position?.start;
      report(
        "CONCEPT_SPEC_APPLICATION_CONSTRUCT",
        "application design links are not allowed in a concept specification",
        start === undefined ? undefined : at(lines[start.line - 1]!, start.column),
      );
    }
    if (node.type === "code" && node.lang === "computations") {
      const start = node.position?.start;
      report(
        "CONCEPT_SPEC_APPLICATION_CONSTRUCT",
        "computations fences are not allowed in a concept specification",
        start === undefined ? undefined : at(lines[start.line - 1]!, start.column),
      );
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown) as MarkdownNode);
}

function sectionOf(
  heading: Heading,
  next: Heading | undefined,
  lines: readonly SourceLine[],
): DocumentSection {
  return {
    heading: heading.name as SectionName,
    location: at(heading.line),
    lines: lines.slice(
      heading.line.number,
      next === undefined ? lines.length : next.line.number - 1,
    ),
  };
}

/** Validate the document skeleton while dividing it into the six required sections. */
function documentOf(
  lines: readonly SourceLine[],
  report: ConceptSpecDiagnosticReporter,
): ParsedDocument {
  const headings: Heading[] = [];
  let open: FenceMarker | undefined;
  for (const line of lines) {
    const marker = markerOf(line.text);
    if (open !== undefined) {
      if (marker !== undefined && closes(marker, open)) open = undefined;
      continue;
    }
    if (marker !== undefined) {
      open = marker;
      continue;
    }
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const name = headingOf(line.text, level);
      if (name !== undefined) {
        headings.push({ level, name, line });
        break;
      }
    }
  }

  for (const subsection of headings.filter(({ level }) => level > 2)) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      "subsection headings are not allowed in a concept specification",
      at(subsection.line),
    );
  }

  const h1s = headings.filter(({ level }) => level === 1);
  if (h1s.length === 0) {
    report("CONCEPT_SPEC_DOCUMENT_STRUCTURE", "the document has no concept-definition H1");
  }
  for (const duplicate of h1s.slice(1)) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      "the document has more than one H1",
      at(duplicate.line),
    );
  }
  const h1 = h1s[0];
  const definitionName = h1 !== undefined && isDesignIdentifier(h1.name) ? h1.name : undefined;
  if (h1 !== undefined && definitionName === undefined) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      `the definition name "${h1.name}" must be an identifier`,
      at(h1.line),
    );
  }

  const h2s = headings.filter(({ level }) => level === 2);
  const known = new Set<string>(SECTION_NAMES);
  for (const unknown of h2s.filter(({ name }) => !known.has(name))) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      `unknown "## ${unknown.name}" section`,
      at(unknown.line),
    );
  }
  for (const name of SECTION_NAMES) {
    const matching = h2s.filter((heading) => heading.name === name);
    if (matching.length === 0) {
      report(
        "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
        `the document has no "## ${name}" section`,
        h1 === undefined ? undefined : at(h1.line),
      );
    }
    for (const duplicate of matching.slice(1)) {
      report(
        "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
        `the document has more than one "## ${name}" section`,
        at(duplicate.line),
      );
    }
  }

  const outOfOrder = h2s.find((heading, index) => heading.name !== SECTION_NAMES[index]);
  if (outOfOrder !== undefined) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      `the H2 sections must be ordered ${SECTION_NAMES.map((name) => `"## ${name}"`).join(", ")}`,
      at(outOfOrder.line),
    );
  }
  const firstH2 = h2s[0];
  if (h1 !== undefined && firstH2 !== undefined && h1.line.number > firstH2.line.number) {
    report(
      "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
      "the concept-definition H1 must precede the H2 sections",
      at(h1.line),
    );
  }

  if (h1 !== undefined && firstH2 !== undefined) {
    const preamble = lines.find(
      ({ number, text }) =>
        text.trim() !== "" &&
        (number < h1.line.number || (number > h1.line.number && number < firstH2.line.number)),
    );
    if (preamble !== undefined) {
      report(
        "CONCEPT_SPEC_DOCUMENT_STRUCTURE",
        "no Markdown is allowed outside the required headings",
        at(preamble),
      );
    }
  }

  const sections: Partial<Record<SectionName, DocumentSection>> = {};
  for (let index = 0; index < h2s.length; index += 1) {
    const heading = h2s[index]!;
    if (!known.has(heading.name)) continue;
    const name = heading.name as SectionName;
    if (sections[name] === undefined) sections[name] = sectionOf(heading, h2s[index + 1], lines);
  }
  return { definitionName, sections };
}

function proseOf(
  section: DocumentSection,
  report: ConceptSpecDiagnosticReporter,
): string | undefined {
  let valid = true;
  for (const fence of section.lines.filter(({ text }) => markerOf(text) !== undefined)) {
    report(
      "CONCEPT_SPEC_PROSE_SECTION",
      `the "## ${section.heading}" section allows prose but no fenced blocks`,
      at(fence),
    );
    valid = false;
  }
  const text = section.lines
    .map(({ text }) => text)
    .join("\n")
    .trim();
  if (text === "") {
    report(
      "CONCEPT_SPEC_PROSE_SECTION",
      `the "## ${section.heading}" section is empty`,
      section.location,
    );
    valid = false;
  }
  return valid ? text : undefined;
}

function normalizedFenceBody(
  lines: readonly SourceLine[],
  fallback: SpecLocation,
): { readonly body: string; readonly location: SpecLocation } {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.text === "") start += 1;
  while (end > start && lines[end - 1]!.text === "") end -= 1;
  const retained = lines.slice(start, end);
  return {
    body: retained.map(({ text }) => text).join("\n"),
    location:
      retained[0] === undefined
        ? { line: fallback.line + 1, column: fallback.column }
        : at(retained[0], fallback.column),
  };
}

function fencedSection(
  section: DocumentSection,
  language: string,
  report: ConceptSpecDiagnosticReporter,
): { readonly contents: readonly SourceLine[]; readonly location: SpecLocation } | undefined {
  const significant = section.lines.findIndex(({ text }) => text.trim() !== "");
  if (significant < 0) {
    report(
      "CONCEPT_SPEC_FENCE",
      `the "## ${section.heading}" section needs exactly one ${language} fence`,
      section.location,
    );
    return undefined;
  }
  const opening = section.lines[significant]!;
  const open = markerOf(opening.text);
  if (open === undefined || open.info !== language) {
    report(
      "CONCEPT_SPEC_FENCE",
      `the "## ${section.heading}" section must begin with a ${language} fence`,
      at(opening),
    );
    return undefined;
  }
  const contents: SourceLine[] = [];
  let closing = -1;
  for (let index = significant + 1; index < section.lines.length; index += 1) {
    const line = section.lines[index]!;
    const marker = markerOf(line.text);
    if (marker !== undefined && closes(marker, open)) {
      closing = index;
      break;
    }
    const removable = Math.min(open.indentation, /^ */.exec(line.text)?.[0].length ?? 0);
    contents.push({ ...line, text: line.text.slice(removable) });
  }
  if (closing < 0) {
    report("CONCEPT_SPEC_FENCE", `the ${language} fence is never closed`, at(opening));
    return undefined;
  }
  for (const outside of section.lines.slice(closing + 1).filter(({ text }) => text.trim() !== "")) {
    report(
      "CONCEPT_SPEC_FENCE",
      language === "state"
        ? "prose after the state fence is not allowed; move this text inside the fence as a `Rule:` line"
        : `the "## ${section.heading}" section allows no Markdown outside its ${language} fence`,
      at(outside),
    );
  }
  return { contents, location: at(opening, open.indentation + 1) };
}

function declarationsOf(
  fence: readonly SourceLine[],
  report: ConceptSpecDiagnosticReporter,
): DeclarationGroup[] {
  const groups: DeclarationGroup[] = [];
  for (const line of fence) {
    if (line.text.trim() === "") {
      if (groups.length > 0) groups[groups.length - 1]!.body.push(line);
    } else if (/^\s/.test(line.text)) {
      if (groups.length === 0) {
        report("CONCEPT_SPEC_DECLARATION", "a declaration body precedes its signature", at(line));
      } else groups[groups.length - 1]!.body.push(line);
    } else groups.push({ signature: line, body: [] });
  }
  return groups;
}

function bodyOf(lines: readonly SourceLine[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.text.trim() === "") start += 1;
  while (end > start && lines[end - 1]!.text.trim() === "") end -= 1;
  if (start === end) return "";
  const selected = lines.slice(start, end);
  const indentation = Math.min(
    ...selected
      .filter(({ text }) => text.trim() !== "")
      .map(({ text }) => /^\s*/.exec(text)?.[0].length ?? 0),
  );
  return selected.map(({ text }) => text.slice(indentation).trimEnd()).join("\n");
}

class SignatureParser {
  readonly #line: SourceLine;
  readonly #reportDiagnostic: ConceptSpecDiagnosticReporter;
  #index = 0;

  constructor(line: SourceLine, report: ConceptSpecDiagnosticReporter) {
    this.#line = line;
    this.#reportDiagnostic = report;
  }

  get location(): SpecLocation {
    return at(this.#line, this.#index + 1);
  }

  #report(what: string, index = this.#index): void {
    this.#reportDiagnostic("CONCEPT_SPEC_SIGNATURE", what, at(this.#line, index + 1));
  }

  #skipSpace(): void {
    while (/\s/.test(this.#line.text[this.#index] ?? "")) this.#index += 1;
  }

  #consume(token: string): boolean {
    this.#skipSpace();
    if (!this.#line.text.startsWith(token, this.#index)) return false;
    this.#index += token.length;
    return true;
  }

  #expect(token: string, what: string): boolean {
    if (this.#consume(token)) return true;
    this.#report(what);
    return false;
  }

  #identifier(
    what: string,
  ): { readonly name: string; readonly location: SpecLocation } | undefined {
    this.#skipSpace();
    const start = this.#index;
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.#line.text.slice(start));
    if (match === null) {
      this.#report(what, start);
      return undefined;
    }
    this.#index += match[0].length;
    return { name: match[0], location: at(this.#line, start + 1) };
  }

  #primaryType(): SpecType | undefined {
    this.#skipSpace();
    const location = this.location;
    if (this.#consume("(")) {
      const grouped = this.type();
      if (grouped === undefined) return undefined;
      if (!this.#expect(")", "a parenthesized type is never closed")) return undefined;
      return grouped;
    }
    const first = this.#identifier("a field needs a type expression");
    if (first === undefined) return undefined;
    let name = first.name;
    while (this.#consume(".")) {
      const part = this.#identifier("a qualified type name needs an identifier");
      if (part === undefined) return undefined;
      name += `.${part.name}`;
    }
    if (name === "null" || name === "undefined") return { kind: name, location };
    const arguments_: SpecType[] = [];
    if (this.#consume("<")) {
      if (this.#consume(">")) {
        this.#report(`the type "${name}" needs a generic argument`);
        return undefined;
      }
      while (true) {
        const argument = this.type();
        if (argument === undefined) return undefined;
        arguments_.push(argument);
        if (this.#consume(">")) break;
        if (!this.#expect(",", `the type arguments for "${name}" need a comma or closing ">"`))
          return undefined;
      }
    }
    return { kind: "named", name, arguments: arguments_, location };
  }

  type(): SpecType | undefined {
    const first = this.#primaryType();
    if (first === undefined) return undefined;
    const members = [first];
    while (this.#consume("|")) {
      const member = this.#primaryType();
      if (member === undefined) return undefined;
      members.push(member);
    }
    return members.length === 1 ? first : { kind: "union", members, location: first.location };
  }

  #fields(
    role: string,
  ): { readonly fields: SpecField[]; readonly location: SpecLocation } | undefined {
    this.#skipSpace();
    const location = this.location;
    if (!this.#expect("(", `${role} need an opening "("`)) return undefined;
    const fields: SpecField[] = [];
    const names = new Set<string>();
    let valid = true;
    if (this.#consume(")")) return { fields, location };
    while (true) {
      const field = this.#identifier(`${role} need a field name`);
      if (field === undefined) return undefined;
      const optional = this.#consume("?");
      if (!this.#expect(":", `the field "${field.name}" needs a type after ":"`)) return undefined;
      const type = this.type();
      if (type === undefined) return undefined;
      if (names.has(field.name)) {
        this.#reportDiagnostic(
          "CONCEPT_SPEC_DUPLICATE_DECLARATION",
          `${role} declare "${field.name}" twice`,
          field.location,
        );
        valid = false;
      }
      names.add(field.name);
      fields.push({ name: field.name, optional, type, location: field.location });
      if (this.#consume(")")) break;
      if (!this.#expect(",", `${role} need a comma or closing ")"`)) return undefined;
    }
    return valid ? { fields, location } : undefined;
  }

  parse():
    | {
        readonly name: string;
        readonly parameters: SpecField[];
        readonly resolution: string;
        readonly result: SpecResult;
        readonly location: SpecLocation;
      }
    | undefined {
    const member = this.#identifier("a declaration needs a member name");
    if (member === undefined) return undefined;
    const parameters = this.#fields("input parameters");
    if (parameters === undefined) return undefined;
    if (!this.#expect(":", "a signature needs a resolution after its inputs")) return undefined;
    const resolution = this.#identifier("a signature needs a resolution after its inputs");
    if (resolution === undefined) return undefined;
    this.#skipSpace();
    if (this.#index >= this.#line.text.length) {
      this.#report(`the "${resolution.name}" resolution needs parenthesized named result fields`);
      return undefined;
    }
    if (this.#line.text[this.#index] !== "(") {
      this.#report("results must use parenthesized named fields");
      return undefined;
    }
    const fields = this.#fields("result fields");
    if (fields === undefined) return undefined;
    const result = { kind: "fields" as const, ...fields };
    this.#skipSpace();
    if (this.#index !== this.#line.text.length) {
      this.#report("the signature has unsupported trailing text");
      return undefined;
    }
    return {
      name: member.name,
      parameters: parameters.fields,
      resolution: resolution.name,
      result,
      location: member.location,
    };
  }
}

type ParsedRefusal =
  | { readonly matched: false }
  | { readonly matched: true; readonly refusal: SpecRefusal | undefined };

function refusalOf(
  action: string,
  line: SourceLine,
  report: ConceptSpecDiagnosticReporter,
): ParsedRefusal {
  const match = REFUSE.exec(line.text.trim());
  if (match === null) return { matched: false };
  let message: string;
  try {
    message = JSON.parse(match[2]) as string;
  } catch {
    report(
      "CONCEPT_SPEC_ACTION_BRANCH",
      `${action}'s "${match[1]}" branch has an invalid quoted sentence`,
      at(line),
    );
    return { matched: true, refusal: undefined };
  }
  if (message.trim() === "") {
    report(
      "CONCEPT_SPEC_ACTION_BRANCH",
      `${action}'s "${match[1]}" branch needs a sentence`,
      at(line),
    );
    return { matched: true, refusal: undefined };
  }
  return {
    matched: true,
    refusal: {
      code: match[1],
      message,
      location: at(line, line.text.indexOf("refuse") + 1),
    },
  };
}

function indentationOf(line: SourceLine): number {
  return /^\s*/.exec(line.text)?.[0].replaceAll("\t", "  ").length ?? 0;
}

function beginsWhere(line: SourceLine): boolean {
  return line.text.trim().startsWith("where ");
}

function branchesOf(
  action: string,
  result: SpecResult,
  body: readonly SourceLine[],
  fallback: SourceLine,
  report: ConceptSpecDiagnosticReporter,
): { readonly refusals: SpecRefusal[]; readonly valid: boolean } {
  const lines = body.filter(({ text }) => text.trim() !== "");
  if (lines.length === 0) {
    report(
      "CONCEPT_SPEC_ACTION_BRANCH",
      `${action} needs at least one explicit where/then branch`,
      at(fallback),
    );
    return { refusals: [], valid: false };
  }

  const refusals: SpecRefusal[] = [];
  const codes = new Set<string>();
  let valid = true;
  let index = 0;
  while (index < lines.length) {
    const where = lines[index]!;
    if (!/^where\s+\S/.test(where.text.trim())) {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s branch must begin with \`where CONDITION\``,
        at(where),
      );
      valid = false;
      index += 1;
      while (index < lines.length && !beginsWhere(lines[index]!)) index += 1;
      continue;
    }

    const then = lines[index + 1];
    if (then === undefined || then.text.trim() !== "then") {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s where branch must be followed by \`then\``,
        at(then ?? where),
      );
      valid = false;
      index += 1;
      while (index < lines.length && !beginsWhere(lines[index]!)) index += 1;
      continue;
    }
    if (indentationOf(then) !== indentationOf(where)) {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s \`where\` and \`then\` lines must have the same indentation`,
        at(then),
      );
      valid = false;
    }

    index += 2;
    const branch: SourceLine[] = [];
    while (index < lines.length && !beginsWhere(lines[index]!)) branch.push(lines[index++]!);
    if (branch.length === 0) {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s then block needs a terminal return or refusal`,
        at(then),
      );
      valid = false;
      continue;
    }

    for (const shallow of branch.filter((line) => indentationOf(line) <= indentationOf(then))) {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s then-block lines must be indented`,
        at(shallow),
      );
      valid = false;
    }
    const terminal = branch[branch.length - 1]!;
    for (const line of branch.slice(0, -1)) {
      if (/^(?:return|refuse)(?:\s|$)/.test(line.text.trim())) {
        report(
          "CONCEPT_SPEC_ACTION_BRANCH",
          `${action}'s return or refusal must terminate its then block`,
          at(line),
        );
        valid = false;
      }
    }

    const returned = RETURN.exec(terminal.text.trim());
    const refusal = refusalOf(action, terminal, report);
    if (returned !== null) {
      const names =
        returned[1] === undefined ? [] : returned[1].split(",").map((name) => name.trim());
      const expected = result.fields.map(({ name }) => name);
      if (
        new Set(names).size !== names.length ||
        names.length !== expected.length ||
        names.some((name) => !expected.includes(name))
      ) {
        report(
          "CONCEPT_SPEC_ACTION_BRANCH",
          `${action}'s successful branch must return exactly ${expected.length === 0 ? "()" : expected.join(", ")}`,
          at(terminal),
        );
        valid = false;
      }
    } else if (refusal.matched) {
      if (refusal.refusal === undefined) {
        valid = false;
      } else if (codes.has(refusal.refusal.code)) {
        report(
          "CONCEPT_SPEC_DUPLICATE_DECLARATION",
          `${action} refuses "${refusal.refusal.code}" twice`,
          at(terminal),
        );
        valid = false;
      } else {
        codes.add(refusal.refusal.code);
        refusals.push(refusal.refusal);
      }
    } else {
      report(
        "CONCEPT_SPEC_ACTION_BRANCH",
        `${action}'s then block must end with \`return ...\` or \`refuse CODE "Normative sentence."\``,
        at(terminal),
      );
      valid = false;
    }
  }
  return { refusals, valid };
}

function parseAction(
  group: DeclarationGroup,
  report: ConceptSpecDiagnosticReporter,
): SpecAction | undefined {
  const signature = new SignatureParser(group.signature, report).parse();
  if (signature === undefined) return undefined;
  let valid = true;
  if (!isDesignIdentifier(signature.name) || signature.name.startsWith("_")) {
    report(
      "CONCEPT_SPEC_DECLARATION",
      `"${signature.name}" is not an action name — queries begin with "_"`,
      at(group.signature),
    );
    valid = false;
  }
  if (signature.resolution !== "return") {
    report(
      "CONCEPT_SPEC_DECLARATION",
      "an action's signature resolves with `: return (…)`",
      at(group.signature),
    );
    valid = false;
  }
  const branches = branchesOf(
    signature.name,
    signature.result,
    group.body,
    group.signature,
    report,
  );
  if (!branches.valid) valid = false;
  if (!valid) return undefined;
  return {
    name: signature.name,
    inputs: signature.parameters.map(({ name }) => name),
    parameters: signature.parameters,
    result: signature.result,
    body: bodyOf(group.body),
    refusals: branches.refusals,
    location: signature.location,
  };
}

function parseQuery(
  group: DeclarationGroup,
  report: ConceptSpecDiagnosticReporter,
): SpecQuery | undefined {
  const signature = new SignatureParser(group.signature, report).parse();
  if (signature === undefined) return undefined;
  let valid = true;
  if (!signature.name.startsWith("_") || !isDesignIdentifier(signature.name)) {
    report(
      "CONCEPT_SPEC_DECLARATION",
      `"${signature.name}" is not a query name — queries begin with "_"`,
      at(group.signature),
    );
    valid = false;
  }
  if (!PROMISES.has(signature.resolution)) {
    report(
      "CONCEPT_SPEC_DECLARATION",
      `a query promises "one", "optional", or "many", not "${signature.resolution}"`,
      at(group.signature),
    );
    valid = false;
  }
  if (!valid) return undefined;
  return {
    name: signature.name,
    inputs: signature.parameters.map(({ name }) => name),
    parameters: signature.parameters,
    result: signature.result,
    body: bodyOf(group.body),
    promise: signature.resolution as QueryPromise,
    location: signature.location,
  };
}

interface ParsedDeclarations<T> {
  readonly values: T[];
  readonly groups: readonly DeclarationGroup[];
}

function parseEach<T extends { readonly name: string; readonly location: SpecLocation }>(
  fence: readonly SourceLine[],
  parse: (group: DeclarationGroup, report: ConceptSpecDiagnosticReporter) => T | undefined,
  kind: string,
  report: ConceptSpecDiagnosticReporter,
): ParsedDeclarations<T> {
  const groups = declarationsOf(fence, report);
  const declared: T[] = [];
  for (const group of groups) {
    const declaration = parse(group, report);
    if (declaration !== undefined) declared.push(declaration);
  }
  const seen = new Set<string>();
  const values: T[] = [];
  for (const declaration of declared) {
    if (seen.has(declaration.name)) {
      report(
        "CONCEPT_SPEC_DUPLICATE_DECLARATION",
        `the ${kind} "${declaration.name}" is declared twice`,
        declaration.location,
      );
      continue;
    }
    seen.add(declaration.name);
    values.push(declaration);
  }
  return { values, groups };
}

function externalTypesOf(
  fence: readonly SourceLine[],
  report: ConceptSpecDiagnosticReporter,
): ParsedDeclarations<SpecExternalType> {
  return parseEach(
    fence,
    (group) => {
      const match = /^external\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(group.signature.text);
      if (match === null) {
        report(
          "CONCEPT_SPEC_DECLARATION",
          "a Types declaration must be `external Name`",
          at(group.signature),
        );
        return undefined;
      }
      return {
        name: match[1],
        explanation: bodyOf(group.body),
        location: at(group.signature, group.signature.text.indexOf(match[1]) + 1),
      };
    },
    "external type",
    report,
  );
}

const sourceDigests = new WeakMap<ConceptSpec, string>();

function normalizedSource(markdown: string): string {
  const withoutBom = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const newlines = withoutBom.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return newlines.endsWith("\n") ? newlines : `${newlines}\n`;
}

function sourceDigest(markdown: string): string {
  return `sha256-${createHash("sha256").update(normalizedSource(markdown), "utf8").digest("hex")}`;
}

function invalidResult(diagnostics: readonly ConceptSpecDiagnostic[]): ConceptSpecParseResult {
  const ordered = [...diagnostics].sort((left, right) => {
    if (left.location.line !== right.location.line) return left.location.line - right.location.line;
    if (left.location.column !== right.location.column)
      return left.location.column - right.location.column;
    if (left.code < right.code) return -1;
    if (left.code > right.code) return 1;
    return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
  });
  return { specification: undefined, diagnostics: ordered };
}

/** The normalized full-source digest retained for a specification parsed in this process. */
export function specificationSourceDigest(specification: ConceptSpec): string | undefined {
  return sourceDigests.get(specification);
}

/** Parse imported Markdown as the strict version-1 concept-specification format. */
export function parseSpec(markdown: string): ConceptSpecParseResult {
  const collector = new ConceptSpecDiagnosticCollector();
  const report = collector.report;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    report(
      "CONCEPT_SPEC_INVALID_INPUT",
      'spec takes the specification\'s markdown text — import it with { type: "text" }',
    );
    return invalidResult(collector.diagnostics);
  }

  const normalized = normalizedSource(markdown);
  const lines = normalized.split("\n").map((text, index) => ({ text, number: index + 1 }));
  rejectApplicationDesign(normalized, lines, report);
  const document = documentOf(lines, report);

  const purpose =
    document.sections.Purpose === undefined
      ? undefined
      : proseOf(document.sections.Purpose, report);
  const principle =
    document.sections.Principle === undefined
      ? undefined
      : proseOf(document.sections.Principle, report);
  const typesFence =
    document.sections.Types === undefined
      ? undefined
      : fencedSection(document.sections.Types, "types", report);
  const stateFence =
    document.sections.State === undefined
      ? undefined
      : fencedSection(document.sections.State, "state", report);
  const actionFence =
    document.sections.Actions === undefined
      ? undefined
      : fencedSection(document.sections.Actions, "actions", report);
  const queryFence =
    document.sections.Queries === undefined
      ? undefined
      : fencedSection(document.sections.Queries, "queries", report);

  const externalTypes =
    typesFence === undefined ? undefined : externalTypesOf(typesFence.contents, report).values;
  const stateBody =
    stateFence === undefined
      ? undefined
      : normalizedFenceBody(stateFence.contents, stateFence.location);
  const actions =
    actionFence === undefined
      ? undefined
      : parseEach(actionFence.contents, parseAction, "action", report);
  if (actions !== undefined && actions.groups.length === 0) {
    report(
      "CONCEPT_SPEC_DECLARATION",
      "the Actions fence must declare at least one action",
      document.sections.Actions!.location,
    );
  }
  const queries =
    queryFence === undefined
      ? undefined
      : parseEach(queryFence.contents, parseQuery, "query", report).values;

  if (
    collector.diagnostics.length > 0 ||
    document.definitionName === undefined ||
    purpose === undefined ||
    principle === undefined ||
    externalTypes === undefined ||
    stateBody === undefined ||
    actions === undefined ||
    queries === undefined
  ) {
    return invalidResult(collector.diagnostics);
  }

  const specification: ConceptSpec = {
    format: "sync-engine.concept-specification",
    version: 1,
    definitionName: document.definitionName,
    purpose,
    principle,
    externalTypes,
    state: {
      body: stateBody.body,
      location: stateBody.location,
    },
    actions: actions.values,
    queries,
  };
  sourceDigests.set(specification, sourceDigest(normalized));
  return { specification, diagnostics: [] };
}

/** Canonical compatibility ignores source positions but retains every authored contract value. */
export function specificationsAreCompatible(left: ConceptSpec, right: ConceptSpec): boolean {
  const withoutLocations = (value: ConceptSpec): string =>
    JSON.stringify(value, (key, item) => (key === "location" ? undefined : item));
  return withoutLocations(left) === withoutLocations(right);
}
