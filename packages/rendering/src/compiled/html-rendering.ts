import type { InterfaceBinding } from "@mit-sdg/sync-engine/boundary";
import {
  isRenderer,
  isRendererInvocation,
  type HtmlNode,
  type RendererDeclaration,
  type RendererInvocation,
  type RendererRead,
  type RendererValueRef,
} from "../language/renderer.ts";

export interface FormedHtmlContent {
  readonly format: "html";
  readonly value: string;
}

export interface FormedHtml {
  readonly holder: string;
  readonly content: FormedHtmlContent;
  readonly fields: readonly string[];
  readonly asks: readonly FormedAsk[];
  readonly reads: readonly FormedRead[];
  /** The server-side standing structure from which exact live patches are derived. */
  readonly tree: FormedHtmlTree;
}

export interface FormedRead {
  readonly concept: string;
  readonly query: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type FormedAskInput =
  | { readonly source: "field"; readonly name: string; readonly address: string }
  | { readonly source: "value"; readonly value: unknown };

export interface FormedAskOutput {
  readonly name: string;
  readonly address: string;
}

export interface FormedAsk {
  readonly id: string;
  readonly concept: string;
  readonly action: string;
  readonly input: Readonly<Record<string, FormedAskInput>>;
  readonly output: Readonly<Record<string, FormedAskOutput>>;
}

export interface FormedHtmlTree {
  readonly kind: "root";
  readonly address: "root";
  readonly children: readonly FormedHtmlNode[];
}

export interface FormedRendererNode {
  readonly kind: "renderer";
  readonly address: string;
  readonly renderer: string;
  readonly children: readonly FormedHtmlNode[];
}

export interface FormedShowNode {
  readonly kind: "show";
  readonly address: string;
  readonly value: string;
}

export interface FormedRowNode {
  readonly kind: "row";
  readonly address: string;
  /** Marked HTML suitable for inserting this exact row into its clause. */
  readonly html: string;
  readonly children: readonly FormedHtmlNode[];
}

export interface FormedClauseNode {
  readonly kind: "clause";
  readonly address: string;
  readonly cardinality: "each" | "where";
  readonly identity?: readonly string[];
  /** HTML between the clause's persistent start and end markers. */
  readonly html: string;
  readonly rows: readonly FormedRowNode[];
}

export type FormedHtmlNode = FormedRendererNode | FormedShowNode | FormedClauseNode;

export type FormedHtmlPatch =
  | { readonly kind: "root"; readonly html: string }
  | { readonly kind: "show"; readonly address: string; readonly value: string }
  | { readonly kind: "clause"; readonly address: string; readonly html: string }
  | {
      readonly kind: "rows";
      readonly address: string;
      readonly order: readonly string[];
      readonly entered: readonly { readonly address: string; readonly html: string }[];
      readonly left: readonly string[];
    };

export interface CompiledHtmlRendering {
  readonly interface: string;
  readonly renderers: readonly string[];
  form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedHtml>;
}

export interface RenderingReader {
  read(
    read: Pick<RendererRead, "concept" | "query">,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}

function samePortableValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => samePortableValue(entry, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(rightRecord).sort((a, b) => a.localeCompare(b));
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && samePortableValue(leftRecord[key], rightRecord[key]),
    )
  );
}

function canonicalPortable(value: unknown, path = "identity"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalPortable(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${path} contains a non-portable ${typeof value} value.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object.`);
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [
        key,
        canonicalPortable((value as Record<string, unknown>)[key], `${path}.${key}`),
      ]),
  );
}

function hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function marker(edge: "start" | "end", address: string): string {
  return `<!--sync:${edge}:${address}-->`;
}

interface Scope {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly fields: ReadonlyMap<string, string>;
}

interface Formation {
  readonly fields: Set<string>;
  readonly asks: FormedAsk[];
  readonly reads: FormedRead[];
}

interface FormedNodeResult {
  readonly html: string;
  readonly children: readonly FormedHtmlNode[];
}

/** Compile the HTML renderer closure admitted by one named interface. */
export function compileHtml(binding: InterfaceBinding): CompiledHtmlRendering {
  const admitted = new Set<string>();
  for (const dependencies of Object.values(binding.dependencies)) {
    for (const dependency of dependencies) {
      if (!isRenderer(dependency.value)) {
        throw new TypeError(
          `compileHtml: dependency ${JSON.stringify(dependency.identity)} is not a renderer declaration.`,
        );
      }
      admitted.add(dependency.identity);
    }
  }
  for (const member of binding.members) {
    if (isRenderer(member.value)) admitted.add(member.identity);
  }

  const renderers = Object.freeze([...admitted].sort((left, right) => left.localeCompare(right)));
  const canonical = (identity: string): RendererDeclaration => {
    if (!admitted.has(identity)) {
      throw new TypeError(
        `compileHtml: renderer ${JSON.stringify(identity)} is not admitted by interface ${JSON.stringify(binding.identity)}.`,
      );
    }
    const assembled = binding.declarations[identity];
    if (assembled === undefined || !isRenderer(assembled.value)) {
      throw new TypeError(
        `compileHtml: renderer ${JSON.stringify(identity)} has no canonical declaration.`,
      );
    }
    return assembled.value.declaration;
  };

  const validateInvocation = (invocation: RendererInvocation, path: string): void => {
    if (!isRendererInvocation(invocation)) {
      throw new TypeError(`compileHtml: ${path} is not a portable renderer invocation.`);
    }
    const identity = invocation.$renderer.identity;
    const declaration = canonical(identity);
    let placement = 0;
    for (const part of invocation.$renderer.body.parts) {
      if (part.kind !== "renderer") continue;
      validateInvocation(part.invocation, `${path}/${identity}[${placement}]`);
      placement += 1;
    }
    if (!samePortableValue(declaration, invocation.$renderer)) {
      throw new TypeError(
        `compileHtml: renderer ${JSON.stringify(identity)} at ${path} does not match its assembled declaration.`,
      );
    }
  };

  const escapeHtml = (value: unknown): string =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const resolve = (value: unknown, scope: Scope): unknown => {
    if (typeof value !== "object" || value === null) return value;
    const reference = value as Partial<RendererValueRef>;
    if (reference.scope === "input" && typeof reference.name === "string") {
      return scope.inputs[reference.name];
    }
    if (reference.scope === "binding" && typeof reference.name === "string") {
      return scope.bindings[reference.name];
    }
    return value;
  };

  const formNode = async (
    node: HtmlNode,
    scope: Scope,
    formation: Formation,
    address: string,
    reader?: RenderingReader,
  ): Promise<FormedNodeResult> => {
    const values: string[] = [];
    const children: FormedHtmlNode[] = [];
    const fields = new Map(scope.fields);
    // Field seats are structural, so asks may fill a field declared later in
    // the same node without making source order part of the interaction contract.
    for (let index = 0; index < node.parts.length; index += 1) {
      const part = node.parts[index];
      if (part.kind !== "field") continue;
      formation.fields.add(part.field.name);
      fields.set(part.field.name, `${address}/${index}/field`);
    }
    for (let index = 0; index < node.parts.length; index += 1) {
      const part = node.parts[index];
      const seat = `${address}/${index}`;
      if (part.kind === "literal") {
        values.push(part.value);
      } else if (part.kind === "show") {
        const showAddress = `${seat}/show`;
        const shown = String(resolve(part.value, scope));
        values.push(
          `${marker("start", showAddress)}${escapeHtml(shown)}${marker("end", showAddress)}`,
        );
        children.push(Object.freeze({ kind: "show", address: showAddress, value: shown }));
      } else if (part.kind === "field") {
        const located = `${seat}/field`;
        values.push(
          `data-rendered-field="${escapeHtml(part.field.name)}" data-rendered-seat="${located}"`,
        );
      } else if (part.kind === "ask") {
        const id = `${seat}/ask`;
        const input = Object.fromEntries(
          Object.entries(part.ask.input).map(([name, value]) => {
            if (
              typeof value === "object" &&
              value !== null &&
              (value as Partial<RendererValueRef>).scope === "field"
            ) {
              const field = value as RendererValueRef;
              const located = fields.get(field.name);
              if (located === undefined) {
                throw new TypeError(
                  `compileHtml.form: ask ${part.ask.concept}.${part.ask.action} uses field ${JSON.stringify(field.name)} before its element is formed.`,
                );
              }
              return [name, { source: "field" as const, name: field.name, address: located }];
            }
            return [name, { source: "value" as const, value: resolve(value, scope) }];
          }),
        );
        const output = Object.fromEntries(
          Object.entries(part.ask.output).map(([name, field]) => {
            const located = fields.get(field.name);
            if (located === undefined) {
              throw new TypeError(
                `compileHtml.form: ask response uses field ${JSON.stringify(field.name)} before its element is formed.`,
              );
            }
            return [name, { name: field.name, address: located }];
          }),
        );
        formation.asks.push(
          Object.freeze({
            id,
            concept: part.ask.concept,
            action: part.ask.action,
            input: Object.freeze(input),
            output: Object.freeze(output),
          }),
        );
        values.push(`data-rendered-ask="${id}"`);
      } else if (part.kind === "renderer") {
        const declaration = canonical(part.invocation.$renderer.identity);
        const inputs = Object.fromEntries(
          declaration.inputs.map((name) => [name, resolve(part.invocation[name], scope)]),
        );
        const childAddress = `${seat}/renderer`;
        const child = await formNode(
          declaration.body,
          { inputs, bindings: {}, fields: new Map() },
          formation,
          childAddress,
          reader,
        );
        values.push(child.html);
        children.push(
          Object.freeze({
            kind: "renderer",
            address: childAddress,
            renderer: declaration.identity,
            children: Object.freeze([...child.children]),
          }),
        );
      } else {
        if (reader === undefined) {
          throw new TypeError("compileHtml.form: a renderer read needs a RenderingReader.");
        }
        const clauseAddress = `${seat}/clause`;
        const input = Object.fromEntries(
          Object.entries(part.read.input).map(([name, value]) => [name, resolve(value, scope)]),
        );
        formation.reads.push(
          Object.freeze({
            concept: part.read.concept,
            query: part.read.query,
            input: Object.freeze(input),
          }),
        );
        const answer = await reader.read(part.read, input);
        if (!Array.isArray(answer)) {
          throw new TypeError(
            `compileHtml.form: ${part.read.concept}.${part.read.query} did not answer rows.`,
          );
        }
        const answeredRows = part.cardinality === "where" ? answer.slice(0, 1) : answer;
        const rows: FormedRowNode[] = [];
        const identities = new Set<string>();
        for (let rowIndex = 0; rowIndex < answeredRows.length; rowIndex += 1) {
          const row = answeredRows[rowIndex];
          if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw new TypeError(
              `compileHtml.form: ${part.read.concept}.${part.read.query} answered a malformed row.`,
            );
          }
          const record = row as Record<string, unknown>;
          let rowSegment: string;
          if (part.cardinality === "each" && part.read.identity !== undefined) {
            for (const field of part.read.identity) {
              if (!Object.hasOwn(record, field)) {
                throw new TypeError(
                  `compileHtml.form: ${part.read.concept}.${part.read.query} row ${rowIndex + 1} has no identity field ${JSON.stringify(field)}.`,
                );
              }
            }
            const key = JSON.stringify(
              canonicalPortable(part.read.identity.map((field) => record[field])),
            );
            if (identities.has(key)) {
              throw new TypeError(
                `compileHtml.form: ${part.read.concept}.${part.read.query} answered duplicate row identity.`,
              );
            }
            identities.add(key);
            rowSegment = `key-${hex(key)}`;
          } else {
            rowSegment = part.cardinality === "where" ? "present" : `index-${rowIndex}`;
          }
          const rowAddress = `${clauseAddress}/${rowSegment}`;
          const bindings: Record<string, unknown> = { ...scope.bindings };
          for (const [field, reference] of Object.entries(part.read.output)) {
            bindings[reference.name] = record[field];
          }
          const body = await formNode(
            part.body,
            { ...scope, bindings, fields },
            formation,
            rowAddress,
            reader,
          );
          const marked =
            part.cardinality === "each" && part.read.identity !== undefined
              ? `${marker("start", rowAddress)}${body.html}${marker("end", rowAddress)}`
              : body.html;
          rows.push(
            Object.freeze({
              kind: "row",
              address: rowAddress,
              html: marked,
              children: Object.freeze([...body.children]),
            }),
          );
        }
        const clauseHtml = rows.map(({ html }) => html).join("");
        values.push(
          `${marker("start", clauseAddress)}${clauseHtml}${marker("end", clauseAddress)}`,
        );
        children.push(
          Object.freeze({
            kind: "clause",
            address: clauseAddress,
            cardinality: part.cardinality,
            ...(part.read.identity === undefined ? {} : { identity: part.read.identity }),
            html: clauseHtml,
            rows: Object.freeze(rows),
          }),
        );
      }
    }
    return { html: values.join(""), children: Object.freeze(children) };
  };

  for (const identity of renderers) {
    const declaration = canonical(identity);
    validateInvocation(
      {
        $renderer: declaration,
        ...Object.fromEntries(declaration.inputs.map((input) => [input, null])),
      },
      `renderer ${JSON.stringify(identity)}`,
    );
  }

  return Object.freeze({
    interface: binding.identity,
    renderers,
    async form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedHtml> {
      if (!isRendererInvocation(invocation)) {
        throw new TypeError("compileHtml.form: endpoint did not return a renderer invocation.");
      }
      const identity = invocation.$renderer.identity;
      validateInvocation(invocation, "endpoint answer");
      const declaration = canonical(identity);
      const formation: Formation = {
        fields: new Set(),
        asks: [],
        reads: [],
      };
      const formed = await formNode(
        declaration.body,
        {
          inputs: invocation as Readonly<Record<string, unknown>>,
          bindings: {},
          fields: new Map(),
        },
        formation,
        "root",
        reader,
      );
      return Object.freeze({
        holder: `${identity}:root`,
        fields: Object.freeze([...formation.fields]),
        asks: Object.freeze([...formation.asks]),
        reads: Object.freeze([...formation.reads]),
        tree: Object.freeze({
          kind: "root" as const,
          address: "root" as const,
          children: Object.freeze([...formed.children]),
        }),
        content: Object.freeze({ format: "html" as const, value: formed.html }),
      });
    },
  });
}

function nodesByAddress(nodes: readonly FormedHtmlNode[]): Map<string, FormedHtmlNode> {
  return new Map(nodes.map((node) => [node.address, node]));
}

function diffChildren(
  previous: readonly FormedHtmlNode[],
  next: readonly FormedHtmlNode[],
  patches: FormedHtmlPatch[],
): void {
  const prior = nodesByAddress(previous);
  for (const node of next) {
    const before = prior.get(node.address);
    if (before === undefined || before.kind !== node.kind) continue;
    if (node.kind === "show" && before.kind === "show") {
      if (node.value !== before.value) {
        patches.push(Object.freeze({ kind: "show", address: node.address, value: node.value }));
      }
      continue;
    }
    if (node.kind === "renderer" && before.kind === "renderer") {
      diffChildren(before.children, node.children, patches);
      continue;
    }
    if (node.kind !== "clause" || before.kind !== "clause") continue;

    const identified = node.cardinality === "each" && node.identity !== undefined;
    if (!identified) {
      if (node.cardinality === "where" && before.rows.length === 1 && node.rows.length === 1) {
        diffChildren(before.rows[0].children, node.rows[0].children, patches);
      } else if (node.html !== before.html) {
        patches.push(Object.freeze({ kind: "clause", address: node.address, html: node.html }));
      }
      continue;
    }

    const beforeRows = new Map(before.rows.map((row) => [row.address, row]));
    const nextRows = new Map(node.rows.map((row) => [row.address, row]));
    const priorOrder = before.rows.map(({ address }) => address);
    const order = node.rows.map(({ address }) => address);
    const entered = node.rows
      .filter(({ address }) => !beforeRows.has(address))
      .map(({ address, html }) => Object.freeze({ address, html }));
    const left = before.rows
      .filter(({ address }) => !nextRows.has(address))
      .map(({ address }) => address);
    if (
      entered.length > 0 ||
      left.length > 0 ||
      order.some((rowAddress, index) => priorOrder[index] !== rowAddress) ||
      order.length !== priorOrder.length
    ) {
      patches.push(
        Object.freeze({
          kind: "rows",
          address: node.address,
          order: Object.freeze(order),
          entered: Object.freeze(entered),
          left: Object.freeze(left),
        }),
      );
    }
    for (const row of node.rows) {
      const beforeRow = beforeRows.get(row.address);
      if (beforeRow !== undefined) diffChildren(beforeRow.children, row.children, patches);
    }
  }
}

/** Derive exact, provenance-addressed changes between two formations of one holder. */
export function diffHtml(previous: FormedHtml, next: FormedHtml): readonly FormedHtmlPatch[] {
  if (previous.holder !== next.holder) {
    return Object.freeze([{ kind: "root", html: next.content.value }]);
  }
  const patches: FormedHtmlPatch[] = [];
  diffChildren(previous.tree.children, next.tree.children, patches);
  if (patches.length === 0 && previous.content.value !== next.content.value) {
    patches.push(Object.freeze({ kind: "root", html: next.content.value }));
  }
  return Object.freeze(patches);
}
