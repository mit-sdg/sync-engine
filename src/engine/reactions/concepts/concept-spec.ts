/**
 * **The machine-readable parts of a concept specification.**
 *
 * The parser extracts purpose and principle prose plus structured action and
 * query declarations from their corresponding Markdown sections. An optional
 * State section is uninterpreted human notation and is not represented by
 * {@link ConceptSpec}.
 *
 * ````md
 * ## Actions
 *
 * ```actions
 * join (gathering: Gathering, member: Person) : return (membership: Membership)
 *   where gathering not in gatherings
 *   then
 *     refuse GATHERING_NOT_FOUND "There is no such gathering."
 * ```
 *
 * ## Queries
 *
 * ```queries
 * _members (gathering: Gathering) : many (member: Person)
 *   orders rows by when each Person joined
 * ```
 * ````
 *
 * A signature line starts at the left margin and everything indented under it
 * is the member's authored behavior. Names, optionality, type expressions,
 * results, and source locations are retained without assigning runtime schema
 * semantics to them. A refusal's message is the normative sentence the
 * boundary reports.
 */

import type {
  ConceptSpecificationIR,
  SpecificationActionIR,
  SpecificationDocumentationIR,
  SpecificationFieldIR,
  SpecificationLocationIR,
  SpecificationQueryIR,
  SpecificationRefusalIR,
  SpecificationResultIR,
  SpecificationTypeIR,
} from "@engine/reads/ir";
import type { QueryPromise } from "@engine/reads/query-metadata";

/** A one-based position in the specification source. */
export type SpecLocation = SpecificationLocationIR;

/** A type expression independent of any implementation language. */
export type SpecType = SpecificationTypeIR;

/** One named field in an input or inline result row. */
export type SpecField = SpecificationFieldIR;

/** An inline result row or a result type expression. */
export type SpecResult = SpecificationResultIR;

/** One refusal branch: the code the boundary returns and the sentence it carries. */
export type SpecRefusal = SpecificationRefusalIR;

/** One action the specification declares. */
export type SpecAction = SpecificationActionIR;

/** One query the specification declares, with the row count it promises. */
export type SpecQuery = SpecificationQueryIR;

/** A reader-facing Types or extension section. */
export type SpecDocumentation = SpecificationDocumentationIR;

/** The machine-readable authored contract extracted from a concept specification. */
export type ConceptSpec = ConceptSpecificationIR;

const PROMISES = new Set<string>(["one", "optional", "many"]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REFUSE = /^refuse\s+(\S+)\s+("(?:[^"\\]|\\.)*")$/;

interface SourceLine {
  text: string;
  number: number;
}

interface DocumentSection {
  heading: string;
  location: SpecLocation;
  lines: SourceLine[];
}

interface DeclarationGroup {
  signature: SourceLine;
  body: SourceLine[];
}

interface FenceMarker {
  character: "`" | "~";
  length: number;
  info: string;
}

function at(line: SourceLine, column = 1): SpecLocation {
  return { line: line.number, column };
}

function fail(what: string, line?: SourceLine, column = 1): never {
  const position = line === undefined ? "" : `line ${line.number}, column ${column}: `;
  const source = line === undefined ? "" : ` — read "${line.text.trim()}"`;
  throw new Error(`spec: ${position}${what}${source}.`);
}

function markerOf(line: string): FenceMarker | undefined {
  const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) return undefined;
  return {
    character: match[1][0] as "`" | "~",
    length: match[1].length,
    info: match[2].trim(),
  };
}

function closes(marker: FenceMarker, open: FenceMarker): boolean {
  return marker.character === open.character && marker.length >= open.length && marker.info === "";
}

/** Divide the document at second-level headings outside fenced code. */
function sectionsOf(lines: readonly SourceLine[]): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let current: DocumentSection | undefined;
  let open: FenceMarker | undefined;

  for (const line of lines) {
    const marker = markerOf(line.text);
    if (open !== undefined) {
      current?.lines.push(line);
      if (marker !== undefined && closes(marker, open)) open = undefined;
      continue;
    }
    if (marker !== undefined) {
      current?.lines.push(line);
      open = marker;
      continue;
    }
    const heading = /^##\s+(.+?)\s*$/.exec(line.text.trim());
    if (heading === null) {
      current?.lines.push(line);
      continue;
    }
    current = { heading: heading[1], location: at(line), lines: [] };
    sections.push(current);
  }
  return sections;
}

function uniqueSection(
  sections: readonly DocumentSection[],
  heading: string,
  required: boolean,
): DocumentSection | undefined {
  const matches = sections.filter((section) => section.heading === heading);
  if (matches.length === 0) {
    if (required) fail(`the document has no "## ${heading}" section`);
    return undefined;
  }
  if (matches.length > 1) {
    fail(`the document has more than one "## ${heading}" section`, {
      text: `## ${heading}`,
      number: matches[1].location.line,
    });
  }
  return matches[0];
}

function proseOf(section: DocumentSection): string {
  const text = section.lines
    .map(({ text }) => text)
    .join("\n")
    .trim();
  if (text === "") {
    fail(`the "## ${section.heading}" section is empty`, {
      text: `## ${section.heading}`,
      number: section.location.line,
    });
  }
  return text;
}

const RESERVED_SECTIONS = new Set(["Purpose", "Principle", "State", "Actions", "Queries"]);

function documentationOf(sections: readonly DocumentSection[]): SpecDocumentation[] {
  return sections
    .filter(({ heading }) => !RESERVED_SECTIONS.has(heading))
    .map((section) => ({
      kind: section.heading === "Types" ? "types" : "extension",
      name: section.heading,
      body: proseOf(section),
      location: section.location,
    }));
}

/** Find a declaration fence only inside its corresponding Markdown section. */
function fenceOf(section: DocumentSection | undefined, language: string): SourceLine[] | undefined {
  if (section === undefined) return undefined;
  let found: SourceLine[] | undefined;
  let open: FenceMarker | undefined;
  let opening: SourceLine | undefined;
  let captured: SourceLine[] | undefined;

  for (const line of section.lines) {
    const marker = markerOf(line.text);
    if (open === undefined) {
      if (marker === undefined) continue;
      open = marker;
      opening = line;
      captured = marker.info === language ? [] : undefined;
      if (captured !== undefined && found !== undefined) {
        fail(`the "## ${section.heading}" section has more than one ${language} block`, line);
      }
      continue;
    }
    if (marker !== undefined && closes(marker, open)) {
      if (captured !== undefined) found = captured;
      open = undefined;
      opening = undefined;
      captured = undefined;
      continue;
    }
    captured?.push(line);
  }
  if (captured !== undefined) fail(`the ${language} block is never closed`, opening);
  return found;
}

/** Split a fence into one group per left-margin signature line. */
function declarationsOf(fence: readonly SourceLine[]): DeclarationGroup[] {
  const groups: DeclarationGroup[] = [];
  for (const line of fence) {
    if (line.text.trim() === "") {
      if (groups.length > 0) groups[groups.length - 1].body.push(line);
      continue;
    }
    if (/^\s/.test(line.text)) {
      if (groups.length === 0) fail("a declaration body precedes its signature", line);
      groups[groups.length - 1].body.push(line);
    } else groups.push({ signature: line, body: [] });
  }
  return groups;
}

function bodyOf(lines: readonly SourceLine[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text.trim() === "") start += 1;
  while (end > start && lines[end - 1].text.trim() === "") end -= 1;
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
  #index = 0;

  constructor(line: SourceLine) {
    this.#line = line;
  }

  get location(): SpecLocation {
    return at(this.#line, this.#index + 1);
  }

  #fail(what: string, index = this.#index): never {
    fail(what, this.#line, index + 1);
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

  #expect(token: string, what: string): void {
    if (!this.#consume(token)) this.#fail(what);
  }

  #identifier(what: string): { name: string; location: SpecLocation } {
    this.#skipSpace();
    const start = this.#index;
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.#line.text.slice(start));
    if (match === null) this.#fail(what, start);
    this.#index += match[0].length;
    return { name: match[0], location: at(this.#line, start + 1) };
  }

  #primaryType(): SpecType {
    this.#skipSpace();
    const location = this.location;
    if (this.#consume("(")) {
      const grouped = this.type();
      this.#expect(")", "a parenthesized type is never closed");
      return grouped;
    }
    const first = this.#identifier("a field needs a type expression");
    let name = first.name;
    while (this.#consume(".")) {
      name += `.${this.#identifier("a qualified type name needs an identifier").name}`;
    }
    if (name === "null" || name === "undefined") {
      return { kind: name, location };
    }
    const arguments_: SpecType[] = [];
    if (this.#consume("<")) {
      if (this.#consume(">")) this.#fail(`the type "${name}" needs a generic argument`);
      while (true) {
        arguments_.push(this.type());
        if (this.#consume(">")) break;
        this.#expect(",", `the type arguments for "${name}" need a comma or closing ">"`);
      }
    }
    return { kind: "named", name, arguments: arguments_, location };
  }

  type(): SpecType {
    const first = this.#primaryType();
    const members = [first];
    while (this.#consume("|")) members.push(this.#primaryType());
    return members.length === 1 ? first : { kind: "union", members, location: first.location };
  }

  #fields(role: string): { fields: SpecField[]; location: SpecLocation } {
    this.#skipSpace();
    const location = this.location;
    this.#expect("(", `${role} need an opening "("`);
    const fields: SpecField[] = [];
    const names = new Set<string>();
    if (this.#consume(")")) return { fields, location };
    while (true) {
      const field = this.#identifier(`${role} need a field name`);
      const optional = this.#consume("?");
      this.#expect(":", `the field "${field.name}" needs a type after ":"`);
      const type = this.type();
      if (names.has(field.name)) this.#fail(`${role} declare "${field.name}" twice`);
      names.add(field.name);
      fields.push({ name: field.name, optional, type, location: field.location });
      if (this.#consume(")")) break;
      this.#expect(",", `${role} need a comma or closing ")"`);
    }
    return { fields, location };
  }

  parse(): {
    name: string;
    parameters: SpecField[];
    resolution: string;
    result: SpecResult;
    location: SpecLocation;
  } {
    const member = this.#identifier("a declaration needs a member name");
    const parameters = this.#fields("input parameters").fields;
    this.#expect(":", "a signature needs a resolution after its inputs");
    const resolution = this.#identifier("a signature needs a resolution after its inputs").name;
    this.#skipSpace();
    if (this.#index >= this.#line.text.length) {
      this.#fail(`the "${resolution}" resolution needs a result declaration`);
    }
    const resultLocation = this.location;
    const result: SpecResult =
      this.#line.text[this.#index] === "("
        ? { kind: "fields", ...this.#fields("result fields") }
        : { kind: "type", type: this.type(), location: resultLocation };
    this.#skipSpace();
    if (this.#index !== this.#line.text.length) {
      this.#fail("the signature has unsupported trailing text");
    }
    return {
      name: member.name,
      parameters,
      resolution,
      result,
      location: member.location,
    };
  }
}

function refusalsOf(action: string, body: readonly SourceLine[]): SpecRefusal[] {
  const refusals: SpecRefusal[] = [];
  const codes = new Set<string>();
  for (const line of body) {
    const text = line.text.trim();
    const refusal = REFUSE.exec(text);
    if (refusal === null) {
      if (text.startsWith("refuse ")) {
        fail('a refusal needs `refuse CODE "Normative sentence."`', line);
      }
      continue;
    }
    const [, code, quoted] = refusal;
    let message: string;
    try {
      message = JSON.parse(quoted) as string;
    } catch {
      fail(`${action}'s "${code}" branch has an invalid quoted sentence`, line);
    }
    if (codes.has(code)) fail(`${action} refuses "${code}" twice`, line);
    if (message.trim() === "") fail(`${action}'s "${code}" branch needs a sentence`, line);
    codes.add(code);
    refusals.push({ code, message, location: at(line, line.text.indexOf("refuse") + 1) });
  }
  return refusals;
}

function parseAction(group: DeclarationGroup): SpecAction {
  const signature = new SignatureParser(group.signature).parse();
  if (!IDENTIFIER.test(signature.name) || signature.name.startsWith("_")) {
    fail(`"${signature.name}" is not an action name — queries begin with "_"`, group.signature);
  }
  if (signature.resolution !== "return") {
    fail("an action's signature resolves with `: return (…)`", group.signature);
  }
  return {
    name: signature.name,
    inputs: signature.parameters.map(({ name }) => name),
    parameters: signature.parameters,
    result: signature.result,
    body: bodyOf(group.body),
    refusals: refusalsOf(signature.name, group.body),
    location: signature.location,
  };
}

function parseQuery(group: DeclarationGroup): SpecQuery {
  const signature = new SignatureParser(group.signature).parse();
  if (!signature.name.startsWith("_") || !IDENTIFIER.test(signature.name)) {
    fail(`"${signature.name}" is not a query name — queries begin with "_"`, group.signature);
  }
  if (!PROMISES.has(signature.resolution)) {
    fail(
      `a query promises "one", "optional", or "many", not "${signature.resolution}"`,
      group.signature,
    );
  }
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

function parseEach<T extends { name: string }>(
  fence: readonly SourceLine[] | undefined,
  parse: (group: DeclarationGroup) => T,
  kind: string,
): T[] {
  const declared = declarationsOf(fence ?? []).map(parse);
  const seen = new Set<string>();
  for (const { name } of declared) {
    if (seen.has(name)) fail(`the ${kind} "${name}" is declared twice`);
    seen.add(name);
  }
  return declared;
}

/**
 * Extract a concept's machine-readable authored contract from specification
 * markdown (import the document with `{ type: "text" }`). Registration assigns
 * runtime meaning only to selected fields. Throws, naming the section or line,
 * when a parsed part is missing or malformed.
 */
export function parseSpec(markdown: string): ConceptSpec {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new Error(
      'spec takes the specification\'s markdown text — import it with { type: "text" }.',
    );
  }
  const lines = markdown.split("\n").map((text, index) => ({ text, number: index + 1 }));
  const sections = sectionsOf(lines);
  return {
    format: "sync-engine.concept-specification",
    version: 1,
    purpose: proseOf(uniqueSection(sections, "Purpose", true) as DocumentSection),
    principle: proseOf(uniqueSection(sections, "Principle", true) as DocumentSection),
    actions: parseEach(
      fenceOf(uniqueSection(sections, "Actions", false), "actions"),
      parseAction,
      "action",
    ),
    queries: parseEach(
      fenceOf(uniqueSection(sections, "Queries", false), "queries"),
      parseQuery,
      "query",
    ),
    documentation: documentationOf(sections),
  };
}
