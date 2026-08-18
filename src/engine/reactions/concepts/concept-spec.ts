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

const SECTION_NAMES = ["Purpose", "Principle", "Types", "State", "Actions", "Queries"] as const;
const PROMISES = new Set<string>(["one", "optional", "many"]);
const REFUSE = /^refuse\s+(\S+)\s+("(?:[^"\\]|\\.)*")$/;
const RETURN = /^return(?:\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*))?$/;

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
  indentation: number;
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

function headingOf(line: string, level: HeadingLevel): string | undefined {
  const hashes = "#".repeat(level);
  const match = new RegExp(`^\\s{0,3}${hashes}(?!#)\\s+(.+?)\\s*#*\\s*$`).exec(line);
  return match?.[1];
}

interface MarkdownNode {
  type: string;
  url?: unknown;
  lang?: unknown;
  children?: readonly MarkdownNode[];
  position?: { start: { line: number; column: number } };
}

/** Reject application-only constructs using Markdown structure rather than source-like text. */
function rejectApplicationDesign(markdown: string, lines: readonly SourceLine[]): void {
  const visit = (node: MarkdownNode): void => {
    if (
      (node.type === "link" || node.type === "definition") &&
      typeof node.url === "string" &&
      /^(?:reaction|view|former|computation):/.test(node.url)
    ) {
      const start = node.position?.start;
      fail(
        "application design links are not allowed in a concept specification",
        start === undefined ? undefined : lines[start.line - 1],
        start?.column,
      );
    }
    if (node.type === "code" && node.lang === "computations") {
      const start = node.position?.start;
      fail(
        "computations fences are not allowed in a concept specification",
        start === undefined ? undefined : lines[start.line - 1],
        start?.column,
      );
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown) as MarkdownNode);
}

/** Validate the document skeleton while dividing it into the six required sections. */
function documentOf(lines: readonly SourceLine[]): {
  definitionName: string;
  sections: readonly DocumentSection[];
} {
  const headings: { level: HeadingLevel; name: string; line: SourceLine }[] = [];
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

  const subsection = headings.find(({ level }) => level > 2);
  if (subsection !== undefined) {
    fail("subsection headings are not allowed in a concept specification", subsection.line);
  }
  const h1s = headings.filter(({ level }) => level === 1);
  if (h1s.length === 0) fail("the document has no concept-definition H1");
  if (h1s.length > 1) fail("the document has more than one H1", h1s[1].line);
  const h1 = h1s[0];
  if (!isDesignIdentifier(h1.name)) {
    fail(`the definition name "${h1.name}" must be an identifier`, h1.line);
  }
  const h2s = headings.filter(({ level }) => level === 2);
  const known = new Set(SECTION_NAMES);
  const unknown = h2s.find(({ name }) => !known.has(name as (typeof SECTION_NAMES)[number]));
  if (unknown !== undefined) fail(`unknown "## ${unknown.name}" section`, unknown.line);
  for (const name of SECTION_NAMES) {
    const matching = h2s.filter((heading) => heading.name === name);
    if (matching.length === 0) fail(`the document has no "## ${name}" section`);
    if (matching.length > 1) {
      fail(`the document has more than one "## ${name}" section`, matching[1].line);
    }
  }
  for (let index = 0; index < SECTION_NAMES.length; index += 1) {
    const actual = h2s[index];
    const expected = SECTION_NAMES[index];
    if (actual?.name !== expected) {
      fail(
        `the H2 sections must be ordered ${SECTION_NAMES.map((name) => `"## ${name}"`).join(", ")}`,
        actual?.line,
      );
    }
  }
  if (h1.line.number > h2s[0].line.number)
    fail("the concept-definition H1 must precede the H2 sections", h1.line);

  const preamble = lines.filter(
    ({ number, text }) =>
      text.trim() !== "" &&
      (number < h1.line.number || (number > h1.line.number && number < h2s[0].line.number)),
  );
  if (preamble.length > 0)
    fail("no Markdown is allowed outside the required headings", preamble[0]);

  const sections = h2s.map((heading, index) => {
    const next = h2s[index + 1];
    return {
      heading: heading.name,
      location: at(heading.line),
      lines: lines.slice(
        heading.line.number,
        next === undefined ? lines.length : next.line.number - 1,
      ),
    };
  });
  return { definitionName: h1.name, sections };
}

function proseOf(section: DocumentSection): string {
  const fence = section.lines.find(({ text }) => markerOf(text) !== undefined);
  if (fence !== undefined) {
    fail(`the "## ${section.heading}" section allows prose but no fenced blocks`, fence);
  }
  const text = section.lines
    .map(({ text }) => text)
    .join("\n")
    .trim();
  if (text === "")
    fail(`the "## ${section.heading}" section is empty`, {
      text: `## ${section.heading}`,
      number: section.location.line,
    });
  return text;
}

function normalizedFenceBody(lines: readonly SourceLine[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].text === "") start += 1;
  while (end > start && lines[end - 1].text === "") end -= 1;
  return lines
    .slice(start, end)
    .map(({ text }) => text)
    .join("\n");
}

function fencedSection(
  section: DocumentSection,
  language: string,
  allowFollowingProse = false,
): {
  contents: SourceLine[];
  prose: string;
  location: SpecLocation;
} {
  const significant = section.lines.findIndex(({ text }) => text.trim() !== "");
  if (significant < 0)
    fail(`the "## ${section.heading}" section needs exactly one ${language} fence`);
  const opening = section.lines[significant];
  const open = markerOf(opening.text);
  if (open === undefined || open.info !== language) {
    fail(`the "## ${section.heading}" section must begin with a ${language} fence`, opening);
  }
  const contents: SourceLine[] = [];
  let closing = -1;
  for (let index = significant + 1; index < section.lines.length; index += 1) {
    const line = section.lines[index];
    const marker = markerOf(line.text);
    if (marker !== undefined && closes(marker, open)) {
      closing = index;
      break;
    }
    const removable = Math.min(open.indentation, /^ */.exec(line.text)?.[0].length ?? 0);
    contents.push({ ...line, text: line.text.slice(removable) });
  }
  if (closing < 0) fail(`the ${language} fence is never closed`, opening);
  const following = section.lines.slice(closing + 1);
  const prose = following
    .map(({ text }) => text)
    .join("\n")
    .trim();
  if (!allowFollowingProse && prose !== "") {
    fail(
      `the "## ${section.heading}" section allows no Markdown outside its ${language} fence`,
      following.find(({ text }) => text.trim() !== ""),
    );
  }
  if (allowFollowingProse && following.some(({ text }) => markerOf(text) !== undefined)) {
    fail(
      `the "## ${section.heading}" section has more than one fenced block`,
      following.find(({ text }) => markerOf(text) !== undefined),
    );
  }
  return { contents, prose, location: at(opening, open.indentation + 1) };
}

function declarationsOf(fence: readonly SourceLine[]): DeclarationGroup[] {
  const groups: DeclarationGroup[] = [];
  for (const line of fence) {
    if (line.text.trim() === "") {
      if (groups.length > 0) groups[groups.length - 1].body.push(line);
    } else if (/^\s/.test(line.text)) {
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
  #consumeWord(word: string): boolean {
    this.#skipSpace();
    if (!this.#line.text.startsWith(word, this.#index)) return false;
    const following = this.#line.text[this.#index + word.length];
    if (following !== undefined && /[A-Za-z0-9_]/.test(following)) return false;
    this.#index += word.length;
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
    while (this.#consume("."))
      name += `.${this.#identifier("a qualified type name needs an identifier").name}`;
    if (name === "null" || name === "undefined") return { kind: name, location };
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
  #names(role: string): string[] {
    this.#expect("(", `${role} need an opening "("`);
    if (this.#consume(")")) this.#fail(`${role} need at least one field name`);
    const names: string[] = [];
    while (true) {
      const field = this.#identifier(`${role} need a field name`);
      if (names.includes(field.name)) this.#fail(`${role} name "${field.name}" twice`);
      names.push(field.name);
      if (this.#consume(")")) return names;
      this.#expect(",", `${role} need a comma or closing ")"`);
    }
  }
  parse(): {
    name: string;
    parameters: SpecField[];
    resolution: string;
    identity?: string[];
    result: SpecResult;
    location: SpecLocation;
  } {
    const member = this.#identifier("a declaration needs a member name");
    const parameters = this.#fields("input parameters").fields;
    this.#expect(":", "a signature needs a resolution after its inputs");
    const resolution = this.#identifier("a signature needs a resolution after its inputs").name;
    let identity: string[] | undefined;
    if (this.#consumeWord("identified")) {
      if (!this.#consumeWord("by")) this.#fail('"identified" must be followed by "by"');
      identity = this.#names("an identity declaration");
    }
    this.#skipSpace();
    if (this.#index >= this.#line.text.length)
      this.#fail(`the "${resolution}" resolution needs parenthesized named result fields`);
    if (this.#line.text[this.#index] !== "(")
      this.#fail("results must use parenthesized named fields");
    const result = { kind: "fields" as const, ...this.#fields("result fields") };
    this.#skipSpace();
    if (this.#index !== this.#line.text.length)
      this.#fail("the signature has unsupported trailing text");
    return {
      name: member.name,
      parameters,
      resolution,
      identity,
      result,
      location: member.location,
    };
  }
}

function refusalOf(action: string, line: SourceLine): SpecRefusal | undefined {
  const match = REFUSE.exec(line.text.trim());
  if (match === null) return undefined;
  let message: string;
  try {
    message = JSON.parse(match[2]) as string;
  } catch {
    fail(`${action}'s "${match[1]}" branch has an invalid quoted sentence`, line);
  }
  if (message.trim() === "") fail(`${action}'s "${match[1]}" branch needs a sentence`, line);
  return { code: match[1], message, location: at(line, line.text.indexOf("refuse") + 1) };
}

function indentationOf(line: SourceLine): number {
  return /^\s*/.exec(line.text)?.[0].replaceAll("\t", "  ").length ?? 0;
}

function branchesOf(
  action: string,
  result: SpecResult,
  body: readonly SourceLine[],
): SpecRefusal[] {
  const lines = body.filter(({ text }) => text.trim() !== "");
  if (lines.length === 0) fail(`${action} needs at least one explicit where/then branch`);
  const refusals: SpecRefusal[] = [];
  const codes = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const where = lines[index];
    if (!/^where\s+\S/.test(where.text.trim()))
      fail(`${action}'s branch must begin with \`where CONDITION\``, where);
    const then = lines[index + 1];
    if (then === undefined || then.text.trim() !== "then")
      fail(`${action}'s where branch must be followed by \`then\``, then ?? where);
    if (indentationOf(then) !== indentationOf(where))
      fail(`${action}'s \`where\` and \`then\` lines must have the same indentation`, then);
    index += 2;
    const branch: SourceLine[] = [];
    while (index < lines.length && !lines[index].text.trim().startsWith("where "))
      branch.push(lines[index++]);
    if (branch.length === 0)
      fail(`${action}'s then block needs a terminal return or refusal`, then);
    const shallow = branch.find((line) => indentationOf(line) <= indentationOf(then));
    if (shallow !== undefined) fail(`${action}'s then-block lines must be indented`, shallow);
    const terminal = branch[branch.length - 1];
    for (const line of branch.slice(0, -1)) {
      if (/^(?:return|refuse)(?:\s|$)/.test(line.text.trim()))
        fail(`${action}'s return or refusal must terminate its then block`, line);
    }
    const returned = RETURN.exec(terminal.text.trim());
    const refusal = refusalOf(action, terminal);
    if (returned !== null) {
      const names =
        returned[1] === undefined ? [] : returned[1].split(",").map((name) => name.trim());
      const expected = result.fields.map(({ name }) => name);
      if (
        new Set(names).size !== names.length ||
        names.length !== expected.length ||
        names.some((name) => !expected.includes(name))
      ) {
        fail(
          `${action}'s successful branch must return exactly ${expected.length === 0 ? "()" : expected.join(", ")}`,
          terminal,
        );
      }
    } else if (refusal !== undefined) {
      if (codes.has(refusal.code)) fail(`${action} refuses "${refusal.code}" twice`, terminal);
      codes.add(refusal.code);
      refusals.push(refusal);
    } else
      fail(
        `${action}'s then block must end with \`return ...\` or \`refuse CODE "Normative sentence."\``,
        terminal,
      );
  }
  return refusals;
}

function parseAction(group: DeclarationGroup): SpecAction {
  const signature = new SignatureParser(group.signature).parse();
  if (!isDesignIdentifier(signature.name) || signature.name.startsWith("_"))
    fail(`"${signature.name}" is not an action name — queries begin with "_"`, group.signature);
  if (signature.resolution !== "return")
    fail("an action's signature resolves with `: return (…)`", group.signature);
  if (signature.identity !== undefined)
    fail("only a `many` query may declare `identified by (…)`", group.signature);
  return {
    name: signature.name,
    inputs: signature.parameters.map(({ name }) => name),
    parameters: signature.parameters,
    result: signature.result,
    body: bodyOf(group.body),
    refusals: branchesOf(signature.name, signature.result, group.body),
    location: signature.location,
  };
}

function parseQuery(group: DeclarationGroup): SpecQuery {
  const signature = new SignatureParser(group.signature).parse();
  if (!signature.name.startsWith("_") || !isDesignIdentifier(signature.name))
    fail(`"${signature.name}" is not a query name — queries begin with "_"`, group.signature);
  if (!PROMISES.has(signature.resolution))
    fail(
      `a query promises "one", "optional", or "many", not "${signature.resolution}"`,
      group.signature,
    );
  if (signature.identity !== undefined && signature.resolution !== "many") {
    fail("only a `many` query may declare `identified by (…)`", group.signature);
  }
  for (const name of signature.identity ?? []) {
    const field = signature.result.fields.find((candidate) => candidate.name === name);
    if (field === undefined) {
      fail(`query identity field "${name}" is not one of its result fields`, group.signature);
    }
    if (field.optional) {
      fail(`query identity field "${name}" cannot be optional`, group.signature);
    }
  }
  return {
    name: signature.name,
    inputs: signature.parameters.map(({ name }) => name),
    parameters: signature.parameters,
    result: signature.result,
    body: bodyOf(group.body),
    promise: signature.resolution as QueryPromise,
    ...(signature.identity === undefined ? {} : { identity: signature.identity }),
    location: signature.location,
  };
}

function parseEach<T extends { name: string }>(
  fence: readonly SourceLine[],
  parse: (group: DeclarationGroup) => T,
  kind: string,
): T[] {
  const declared = declarationsOf(fence).map(parse);
  const seen = new Set<string>();
  for (const { name } of declared) {
    if (seen.has(name)) fail(`the ${kind} "${name}" is declared twice`);
    seen.add(name);
  }
  return declared;
}

function externalTypesOf(fence: readonly SourceLine[]): SpecExternalType[] {
  return parseEach(
    fence,
    (group) => {
      const match = /^external\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(group.signature.text);
      if (match === null) fail("a Types declaration must be `external Name`", group.signature);
      return {
        name: match[1],
        explanation: bodyOf(group.body),
        location: at(group.signature, group.signature.text.indexOf(match[1]) + 1),
      };
    },
    "external type",
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

/** The normalized full-source digest retained for a specification parsed in this process. */
export function specificationSourceDigest(specification: ConceptSpec): string | undefined {
  return sourceDigests.get(specification);
}

/** Parse imported Markdown as the strict version-1 concept-specification format. */
export function parseSpec(markdown: string): ConceptSpec {
  if (typeof markdown !== "string" || markdown.trim() === "")
    throw new Error(
      'spec takes the specification\'s markdown text — import it with { type: "text" }.',
    );
  const normalized = normalizedSource(markdown);
  const lines = normalized.split("\n").map((text, index) => ({ text, number: index + 1 }));
  rejectApplicationDesign(normalized, lines);
  const { definitionName, sections } = documentOf(lines);
  const [purpose, principle, types, state, actions, queries] = sections;
  const typesFence = fencedSection(types, "types");
  const stateFence = fencedSection(state, "state", true);
  const actionFence = fencedSection(actions, "actions");
  const queryFence = fencedSection(queries, "queries");
  const parsedActions = parseEach(actionFence.contents, parseAction, "action");
  if (parsedActions.length === 0)
    fail("the Actions fence must declare at least one action", {
      text: "## Actions",
      number: actions.location.line,
    });
  const specification: ConceptSpec = {
    format: "sync-engine.concept-specification",
    version: 1,
    definitionName,
    purpose: proseOf(purpose),
    principle: proseOf(principle),
    externalTypes: externalTypesOf(typesFence.contents),
    state: {
      body: normalizedFenceBody(stateFence.contents),
      prose: stateFence.prose,
      location: stateFence.location,
    },
    actions: parsedActions,
    queries: parseEach(queryFence.contents, parseQuery, "query"),
  };
  sourceDigests.set(specification, sourceDigest(normalized));
  return specification;
}

/** Canonical compatibility ignores source positions but retains every authored contract value. */
export function specificationsAreCompatible(left: ConceptSpec, right: ConceptSpec): boolean {
  const withoutLocations = (value: ConceptSpec): string =>
    JSON.stringify(value, (key, item) => (key === "location" ? undefined : item));
  return withoutLocations(left) === withoutLocations(right);
}
