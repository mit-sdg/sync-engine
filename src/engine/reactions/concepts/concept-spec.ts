/**
 * **The machine-readable parts of a concept specification.**
 *
 * Registration extracts purpose and principle prose, action names, inputs and
 * refusal branches from an `actions` fence, and query names, inputs and
 * cardinality from a `queries` fence. An optional State section is
 * uninterpreted human notation and is not represented by {@link ConceptSpec}.
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
 * ```
 * ````
 *
 * A signature line starts at the left margin and everything indented under it
 * is the member's authored behavior. The parser reads the signatures and the
 * action `refuse CODE "message"` lines; the rest of each action or query body
 * stays prose for a reader. A refusal's message is the normative sentence the
 * boundary reports.
 */

import type { QueryPromise } from "@engine/reads/query-metadata";

/** One refusal branch: the code the boundary returns and the sentence it carries. */
interface SpecRefusal {
  code: string;
  message: string;
}

/** One action the specification declares. */
interface SpecAction {
  name: string;
  inputs: readonly string[];
  refusals: readonly SpecRefusal[];
}

/** One query the specification declares, with the row count it promises. */
interface SpecQuery {
  name: string;
  inputs: readonly string[];
  promise: QueryPromise;
}

/** The machine-readable registration contract extracted from a concept specification. */
export interface ConceptSpec {
  purpose: string;
  principle: string;
  actions: readonly SpecAction[];
  queries: readonly SpecQuery[];
}

const PROMISES = new Set<string>(["one", "optional", "many"]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SIGNATURE = /^(\S+)\s*\(([^)]*)\)\s*:\s*(\S+)/;
const REFUSE = /^refuse\s+(\S+)\s+"([^"]*)"$/;

function fail(what: string, line?: string): never {
  throw new Error(`spec: ${what}${line === undefined ? "" : ` — read "${line.trim()}"`}.`);
}

/** The lines of a named fenced block, or undefined when the document has none. */
function fenceOf(lines: readonly string[], language: string): string[] | undefined {
  const start = lines.findIndex((line) => line.trim() === `\`\`\`${language}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.trim().startsWith("```"));
  if (end === -1) fail(`the ${language} block is never closed`);
  return lines.slice(start + 1, end);
}

function sectionOf(lines: readonly string[], heading: string): string {
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) fail(`the document has no "## ${heading}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) {
      end = i;
      break;
    }
  }
  const text = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  if (text === "") fail(`the "## ${heading}" section is empty`);
  return text;
}

/** The parameter names of a signature's `(name: Type, …)` list. */
function inputsOf(parameters: string, line: string): string[] {
  const body = parameters.trim();
  if (body === "") return [];
  return body.split(",").map((parameter) => {
    const name = parameter.split(":")[0].trim();
    if (!IDENTIFIER.test(name)) fail(`"${name}" is not a parameter name`, line);
    return name;
  });
}

/** Split a fence into one group of lines per left-margin signature line. */
function declarationsOf(fence: readonly string[]): string[][] {
  const groups: string[][] = [];
  for (const line of fence) {
    if (line.trim() === "") continue;
    if (/^\s/.test(line)) {
      if (groups.length === 0) fail("a declaration body precedes its signature", line);
      groups[groups.length - 1].push(line);
    } else groups.push([line]);
  }
  return groups;
}

function parseAction(group: readonly string[]): SpecAction {
  const [signature, ...body] = group;
  const match = SIGNATURE.exec(signature);
  if (match === null) {
    fail("an action needs a `name (inputs) : return (outputs)` signature", signature);
  }
  const [, name, parameters, resolution] = match;
  if (!IDENTIFIER.test(name) || name.startsWith("_")) {
    fail(`"${name}" is not an action name — queries begin with "_"`, signature);
  }
  if (resolution !== "return") {
    fail("an action's signature resolves with `: return (…)`", signature);
  }
  const refusals: SpecRefusal[] = [];
  const codes = new Set<string>();
  for (const line of body) {
    const refusal = REFUSE.exec(line.trim());
    if (refusal === null) continue;
    const [, code, message] = refusal;
    if (codes.has(code)) fail(`${name} refuses "${code}" twice`, line);
    if (message.trim() === "") fail(`${name}'s "${code}" branch needs a sentence`, line);
    codes.add(code);
    refusals.push({ code, message });
  }
  return { name, inputs: inputsOf(parameters, signature), refusals };
}

function parseQuery(group: readonly string[]): SpecQuery {
  const [signature] = group;
  const match = SIGNATURE.exec(signature);
  if (match === null) {
    fail("a query needs a `_name (inputs) : promise (outputs)` signature", signature);
  }
  const [, name, parameters, promise] = match;
  if (!name.startsWith("_") || !IDENTIFIER.test(name)) {
    fail(`"${name}" is not a query name — queries begin with "_"`, signature);
  }
  if (!PROMISES.has(promise)) {
    fail(`a query promises "one", "optional", or "many", not "${promise}"`, signature);
  }
  return { name, inputs: inputsOf(parameters, signature), promise: promise as QueryPromise };
}

function parseEach<T extends { name: string }>(
  fence: readonly string[] | undefined,
  parse: (group: readonly string[]) => T,
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
 * Extract a concept's machine-readable registration contract from specification
 * markdown (import the document with `{ type: "text" }`). Throws, naming the
 * section or line, when a parsed part is missing or malformed.
 */
export function parseSpec(markdown: string): ConceptSpec {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new Error(
      'spec takes the specification\'s markdown text — import it with { type: "text" }.',
    );
  }
  const lines = markdown.split("\n");
  return {
    purpose: sectionOf(lines, "Purpose"),
    principle: sectionOf(lines, "Principle"),
    actions: parseEach(fenceOf(lines, "actions"), parseAction, "action"),
    queries: parseEach(fenceOf(lines, "queries"), parseQuery, "query"),
  };
}
