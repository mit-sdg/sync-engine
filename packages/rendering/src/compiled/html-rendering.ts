import type { InterfaceBinding } from "@mit-sdg/sync-engine/boundary";
import {
  isImmediate,
  isRenderer,
  isRendererInvocation,
  type HtmlNode,
  type RendererDeclaration,
  type RendererInvocation,
  type RendererRead,
  type RendererValueRef,
} from "../language/renderer.ts";
import { identifyRow, samePortableValue } from "./shared.ts";

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
  /** Refusal display seats this ask reports into, when `.refuses({ ... })` was authored. */
  readonly refuses?: Readonly<Record<string, FormedAskOutput>>;
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

export interface FormedAttributeNode {
  readonly kind: "attr";
  readonly address: string;
  /** Marker value carried by the owning element's `data-rendered-attrs`. */
  readonly element: string;
  readonly name: string;
  /** The rendered attribute value; "" renders the bare attribute, null renders nothing. */
  readonly value: string | null;
}

export type FormedHtmlNode =
  | FormedRendererNode
  | FormedShowNode
  | FormedClauseNode
  | FormedAttributeNode;

export type FormedHtmlPatch =
  | { readonly kind: "root"; readonly html: string }
  | { readonly kind: "show"; readonly address: string; readonly value: string }
  | {
      readonly kind: "attr";
      readonly element: string;
      readonly name: string;
      readonly value: string | null;
    }
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
  /** Immediate identities invoked anywhere in the admitted renderer tree. */
  readonly immediates: readonly string[];
  form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedHtml>;
}

export interface RenderingReader {
  read(
    read: Pick<RendererRead, "concept" | "query">,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}

function marker(edge: "start" | "end", address: string): string {
  return `<!--sync:${edge}:${address}-->`;
}

interface Scope {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly fields: ReadonlyMap<string, string>;
  readonly refusals: ReadonlyMap<string, string>;
}

/** Resolve one bound attribute to its rendered value: "" bare, null absent. */
function attributeValue(
  part: Extract<HtmlNode["parts"][number], { kind: "attribute" }>,
  resolve: (value: unknown) => unknown,
): string | null {
  const where = `attribute ${JSON.stringify(part.name)}`;
  if (part.form === "presence") {
    const sole = part.value.find((entry) => entry.kind === "ref");
    const resolved = sole === undefined ? undefined : resolve(sole.ref);
    if (typeof resolved !== "boolean") {
      throw new TypeError(
        `compileHtml.form: presence ${where} needs a boolean; got ${typeof resolved} — ` +
          `use ${part.name}=\${...} for a value seat.`,
      );
    }
    return resolved ? "" : null;
  }
  const sole = part.value.length === 1 && part.value[0].kind === "ref";
  const pieces: string[] = [];
  for (const entry of part.value) {
    if (entry.kind === "literal") {
      pieces.push(entry.value);
      continue;
    }
    const resolved = resolve(entry.ref);
    if (typeof resolved === "boolean") {
      throw new TypeError(
        `compileHtml.form: ${where} bound a boolean; presence seats are spelled ?${part.name}=\${...}.`,
      );
    }
    if (resolved === null || resolved === undefined) {
      if (sole) return null;
      throw new TypeError(
        `compileHtml.form: ${where} mixes literal text with an absent value; ` +
          "a removable attribute takes the sole bound value.",
      );
    }
    if (typeof resolved !== "string" && typeof resolved !== "number") {
      throw new TypeError(`compileHtml.form: ${where} needs a string; got ${typeof resolved}.`);
    }
    pieces.push(String(resolved));
  }
  const value = pieces.join("");
  if (part.check !== undefined && !urlAllowed(value, part.check)) {
    throw new TypeError(
      `compileHtml.form: ${where} refused the value ${JSON.stringify(value)}; ` +
        (part.check === "relative-url"
          ? "only relative paths are allowed here."
          : "only relative paths and https: URLs are allowed here."),
    );
  }
  return value;
}

function urlAllowed(value: string, check: "url" | "relative-url"): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("//")) return false;
  const scheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(trimmed);
  if (scheme === null) return true;
  return check === "url" && scheme[0].toLowerCase() === "https:";
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
  const admittedImmediates = new Set<string>();
  for (const dependencies of Object.values(binding.dependencies)) {
    for (const dependency of dependencies) {
      if (isImmediate(dependency.value)) {
        admittedImmediates.add(dependency.identity);
        continue;
      }
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
    if (isImmediate(member.value)) admittedImmediates.add(member.identity);
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
    if (declaration.body.kind !== "html") {
      throw new TypeError(
        `compileHtml: renderer ${JSON.stringify(identity)} at ${path} uses the ${declaration.body.kind} family.`,
      );
    }
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
    const refusals = new Map(scope.refusals);
    const markedElements = new Set<number>();
    // Field and refusal seats are structural, so asks may use a seat declared
    // later in the same node without making source order part of the contract.
    for (let index = 0; index < node.parts.length; index += 1) {
      const part = node.parts[index];
      if (part.kind === "field") {
        formation.fields.add(part.field.name);
        fields.set(part.field.name, `${address}/${index}/field`);
      } else if (part.kind === "refusal") {
        refusals.set(part.seat.name, `${address}/${index}/refusal`);
      }
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
      } else if (part.kind === "refusal") {
        values.push(`data-rendered-refusal="${seat}/refusal"`);
      } else if (part.kind === "attribute") {
        const elementAddress = `${address}/e${part.element}`;
        const rendered = attributeValue(part, (value) => resolve(value, scope));
        const marker = markedElements.has(part.element)
          ? ""
          : `data-rendered-attrs="${elementAddress}"`;
        markedElements.add(part.element);
        const text =
          rendered === null
            ? ""
            : rendered === "" && part.form === "presence"
              ? part.name
              : `${part.name}="${escapeHtml(rendered)}"`;
        values.push([marker, text].filter((piece) => piece !== "").join(" "));
        children.push(
          Object.freeze({
            kind: "attr" as const,
            address: `${elementAddress}/${part.name}`,
            element: elementAddress,
            name: part.name,
            value: rendered,
          }),
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
        let refuses: Readonly<Record<string, FormedAskOutput>> | undefined;
        if (part.ask.refuses !== undefined) {
          refuses = Object.freeze(
            Object.fromEntries(
              Object.entries(part.ask.refuses).map(([name, seatRef]) => {
                const located = refusals.get(seatRef.name);
                if (located === undefined) {
                  throw new TypeError(
                    `compileHtml.form: ask ${part.ask.concept}.${part.ask.action} refuses into ` +
                      `seat ${JSON.stringify(seatRef.name)} before its element is formed.`,
                  );
                }
                return [name, { name: seatRef.name, address: located }];
              }),
            ),
          );
        }
        formation.asks.push(
          Object.freeze({
            id,
            concept: part.ask.concept,
            action: part.ask.action,
            input: Object.freeze(input),
            output: Object.freeze(output),
            ...(refuses === undefined ? {} : { refuses }),
          }),
        );
        const askFields = [
          ...Object.values(input as Record<string, FormedAskInput>).map((source) =>
            source.source === "field" ? source.address : "",
          ),
          ...Object.values(output as Record<string, FormedAskOutput>).map((field) => field.address),
        ].filter((located) => located !== "");
        const askAttributes = [`data-rendered-ask="${id}"`];
        if (askFields.length > 0) {
          askAttributes.push(`data-rendered-ask-fields="${[...new Set(askFields)].join(" ")}"`);
        }
        if (refuses !== undefined) {
          askAttributes.push(
            `data-rendered-ask-refuses="${Object.values(refuses)
              .map((seatOut) => seatOut.address)
              .join(" ")}"`,
          );
        }
        values.push(askAttributes.join(" "));
      } else if (part.kind === "immediate") {
        const declared = part.invocation.$immediate;
        if (!admittedImmediates.has(declared.identity)) {
          throw new TypeError(
            `compileHtml.form: immediate ${JSON.stringify(declared.identity)} is not admitted by ` +
              `interface ${JSON.stringify(binding.identity)}.`,
          );
        }
        const locate = (reference: { name: string }): string => {
          const located = fields.get(reference.name);
          if (located === undefined) {
            throw new TypeError(
              `compileHtml.form: immediate ${JSON.stringify(declared.identity)} uses field ` +
                `${JSON.stringify(reference.name)} before its element is formed.`,
            );
          }
          return located;
        };
        const args = Object.fromEntries(
          Object.entries(part.invocation.args).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.map(locate) : locate(value as { name: string }),
          ]),
        );
        const payload = JSON.stringify({ immediate: declared.identity, args });
        values.push(`data-rendered-on-${declared.on}="${escapeHtml(payload)}"`);
      } else if (part.kind === "renderer") {
        const declaration = canonical(part.invocation.$renderer.identity);
        if (declaration.body.kind !== "html") {
          throw new TypeError(
            `compileHtml.form: renderer ${JSON.stringify(declaration.identity)} uses the ${declaration.body.kind} family.`,
          );
        }
        const inputs = Object.fromEntries(
          declaration.inputs.map((name) => [name, resolve(part.invocation[name], scope)]),
        );
        const childAddress = `${seat}/renderer`;
        const child = await formNode(
          declaration.body,
          { inputs, bindings: {}, fields: new Map(), refusals: new Map() },
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
          const { segment: rowSegment } = identifyRow(
            part.read,
            part.cardinality,
            record,
            rowIndex,
            identities,
            "compileHtml.form",
          );
          const rowAddress = `${clauseAddress}/${rowSegment}`;
          const bindings: Record<string, unknown> = { ...scope.bindings };
          for (const [field, reference] of Object.entries(part.read.output)) {
            bindings[reference.name] = record[field];
          }
          const body = await formNode(
            part.body,
            { ...scope, bindings, fields, refusals },
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

  const usedImmediates = new Set<string>();
  const collectImmediates = (node: HtmlNode): void => {
    for (const part of node.parts) {
      if (part.kind === "immediate") usedImmediates.add(part.invocation.$immediate.identity);
      else if (part.kind === "read" && part.body.kind === "html") collectImmediates(part.body);
      else if (part.kind === "renderer" && part.invocation.$renderer.body.kind === "html") {
        collectImmediates(part.invocation.$renderer.body);
      }
    }
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
    if (declaration.body.kind === "html") collectImmediates(declaration.body);
  }
  for (const identity of usedImmediates) {
    if (!admittedImmediates.has(identity)) {
      throw new TypeError(
        `compileHtml: immediate ${JSON.stringify(identity)} is not admitted by interface ${JSON.stringify(binding.identity)}.`,
      );
    }
  }

  return Object.freeze({
    interface: binding.identity,
    renderers,
    immediates: Object.freeze([...usedImmediates].sort((left, right) => left.localeCompare(right))),
    async form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedHtml> {
      if (!isRendererInvocation(invocation)) {
        throw new TypeError("compileHtml.form: endpoint did not return a renderer invocation.");
      }
      const identity = invocation.$renderer.identity;
      validateInvocation(invocation, "endpoint answer");
      const declaration = canonical(identity);
      if (declaration.body.kind !== "html") {
        throw new TypeError(
          `compileHtml.form: renderer ${JSON.stringify(identity)} uses the ${declaration.body.kind} family.`,
        );
      }
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
          refusals: new Map(),
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
    if (node.kind === "attr" && before.kind === "attr") {
      if (node.value !== before.value) {
        patches.push(
          Object.freeze({
            kind: "attr",
            element: node.element,
            name: node.name,
            value: node.value,
          }),
        );
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
