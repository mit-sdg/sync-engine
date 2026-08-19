import { interfaceDeclaration } from "@mit-sdg/sync-engine/advanced";
import type { ReadLine } from "@mit-sdg/sync-engine/language";

export type RendererInputs = Record<string, unknown>;
export type RendererBindings = Record<string, unknown>;

export interface RendererValueRef {
  readonly scope: "input" | "binding" | "field";
  readonly name: string;
}

export interface RendererAsk {
  readonly concept: string;
  readonly action: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, RendererValueRef>>;
  /** Display seats that present this ask's refusal detail, from `.refuses({ ... })`. */
  readonly refuses?: Readonly<Record<string, RendererValueRef>>;
}

export interface RendererRead {
  readonly concept: string;
  readonly query: string;
  /** Result fields whose values identify rows, as promised by the query declaration. */
  readonly identity?: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, RendererValueRef>>;
}

export type AttributeValuePart =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "ref"; readonly ref: RendererValueRef };

export type ImmediateTrigger = "accepted" | "refused";

export type ImmediateArgKind = "field" | { readonly many: "field" };

/** Declare that an immediate argument names several values of one kind. */
export function many(kind: "field"): { readonly many: "field" } {
  return Object.freeze({ many: kind });
}

export interface ImmediateDeclaration {
  readonly format: "sync-engine.immediate";
  readonly version: 1;
  readonly identity: string;
  readonly description: string;
  readonly on: ImmediateTrigger;
  readonly contract: Readonly<Record<string, ImmediateArgKind>>;
}

export interface ImmediateInvocation {
  readonly $immediate: ImmediateDeclaration;
  readonly args: Readonly<Record<string, RendererValueRef | readonly RendererValueRef[]>>;
}

export interface Immediate {
  (args: Record<string, unknown>): ImmediateInvocation;
  readonly declaration: ImmediateDeclaration;
}

export interface HtmlNode {
  readonly kind: "html";
  readonly parts: readonly (
    | { readonly kind: "literal"; readonly value: string }
    | { readonly kind: "show"; readonly value: RendererValueRef }
    | { readonly kind: "field"; readonly field: RendererValueRef }
    | { readonly kind: "refusal"; readonly seat: RendererValueRef }
    | {
        readonly kind: "attribute";
        /** Ordinal of the owning open tag within this node, for element addressing. */
        readonly element: number;
        readonly name: string;
        readonly form: "value" | "presence";
        /** URL hygiene applied when the resolved value is formed or patched. */
        readonly check?: "url" | "relative-url";
        readonly value: readonly AttributeValuePart[];
      }
    | { readonly kind: "ask"; readonly ask: RendererAsk }
    | { readonly kind: "immediate"; readonly invocation: ImmediateInvocation }
    | {
        readonly kind: "read";
        readonly cardinality: "each" | "where";
        readonly read: RendererRead;
        readonly body: HtmlNode;
      }
    | { readonly kind: "renderer"; readonly invocation: RendererInvocation }
  )[];
}

export type RenderingNode = HtmlNode;

export interface RendererDeclaration {
  readonly format: "sync-engine.renderer";
  readonly version: 1;
  readonly identity: string;
  readonly description: string;
  readonly inputs: readonly string[];
  readonly body: RenderingNode;
}

export type RendererInvocation<Inputs extends RendererInputs = RendererInputs> = {
  readonly $renderer: RendererDeclaration;
} & Inputs;

export interface Renderer<Inputs extends RendererInputs = RendererInputs> {
  (inputs: Inputs): RendererInvocation<Inputs>;
  readonly declaration: RendererDeclaration;
}

export type RendererBuilder<
  Inputs extends RendererInputs = RendererInputs,
  Bindings extends RendererBindings = RendererBindings,
  Fields extends RendererBindings = RendererBindings,
> = (inputs: Inputs, bindings: Bindings, fields: Fields) => RenderingNode;

const Renderers = new WeakSet<object>();

interface RendererBuildContext {
  readonly values: Map<symbol, RendererValueRef>;
}

const RendererBuildContexts: RendererBuildContext[] = [];

function currentBuildContext(): RendererBuildContext | undefined {
  return RendererBuildContexts[RendererBuildContexts.length - 1];
}

// Renderer builders discover their authored names by observing proxy access.
// An unannotated builder should therefore remain an open DSL surface; exact
// caller inputs are checked from the resulting declaration. Explicit generic
// arguments remain available to host integrations that want TypeScript types.
// biome-ignore lint/suspicious/noExplicitAny: open proxy keys are intentionally unenumerated.
type OpenRendererBag = Record<string, any>;

// ── markup scanning ────────────────────────────────────────────────────────
//
// The scanner classifies every template hole by the markup position it lands
// in: content, an element's tag (arming seats), an attribute-value seat, raw
// text (script/style content), or a comment. It also tracks the open element's
// name for the guarded-element walls and numbers open tags so attribute seats
// can be grouped per element.

type ScanState = "content" | "tag" | "squote" | "dquote" | "comment" | "rawtext";

const GUARDED_ELEMENTS = new Set(["script", "link", "base", "meta"]);
const RAW_TEXT_ELEMENTS = new Set(["script", "style"]);

class MarkupScanner {
  state: ScanState = "content";
  /** Lowercased name of the tag currently being scanned, "" outside a tag. */
  tag = "";
  /** Raw-text element whose content we are inside, "" otherwise. */
  rawTag = "";
  /** Attribute name whose value seat the scan is at or inside, "" if none. */
  attribute = "";
  /** True exactly after `name=` while an unquoted value may still begin. */
  valueStart = false;
  /** Ordinal of the most recently opened tag, for attribute grouping. */
  element = 0;
  /** Chunk-relative index where the current attribute's name token began. */
  attributeStart = -1;

  #nameToken = "";
  #nameStart = -1;
  #tagNamePending = false;
  #inUnquotedValue = false;

  /** Scan one literal chunk, updating position state. */
  scan(chunk: string): void {
    this.attributeStart = -1;
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      if (this.state === "comment") {
        if (chunk.startsWith("-->", index)) {
          this.state = "content";
          index += 2;
        }
        continue;
      }
      if (this.state === "rawtext") {
        if (character === "<" && chunk.startsWith(`</${this.rawTag}`, index)) {
          const closed = this.rawTag;
          this.state = "tag";
          this.tag = `/${closed}`;
          this.rawTag = "";
          this.#tagNamePending = false;
          index += closed.length + 1;
        }
        continue;
      }
      if (this.state === "squote") {
        if (character === "'") this.#closeValue();
        continue;
      }
      if (this.state === "dquote") {
        if (character === '"') this.#closeValue();
        continue;
      }
      if (this.state === "tag") {
        if (this.#tagNamePending) {
          if (/[\s/>]/.test(character)) {
            this.#tagNamePending = false;
          } else {
            this.tag += character.toLowerCase();
            continue;
          }
        }
        if (character === "'") {
          this.state = "squote";
          this.valueStart = false;
          continue;
        }
        if (character === '"') {
          this.state = "dquote";
          this.valueStart = false;
          continue;
        }
        if (character === ">") {
          const opened = this.tag;
          this.state = "content";
          if (!opened.startsWith("/") && RAW_TEXT_ELEMENTS.has(opened)) {
            this.state = "rawtext";
            this.rawTag = opened;
          }
          this.tag = "";
          this.#resetAttribute();
          continue;
        }
        if (character === "=") {
          this.attribute = this.#nameToken;
          this.attributeStart = this.#nameStart;
          this.#nameToken = "";
          this.valueStart = true;
          this.#inUnquotedValue = false;
          continue;
        }
        if (/[\s/]/.test(character)) {
          this.#resetAttribute();
          continue;
        }
        if (this.valueStart || this.#inUnquotedValue) {
          this.valueStart = false;
          this.#inUnquotedValue = true;
          continue;
        }
        if (this.#nameToken === "") this.#nameStart = index;
        this.#nameToken += character.toLowerCase();
        continue;
      }
      if (chunk.startsWith("<!--", index)) {
        this.state = "comment";
        index += 3;
      } else if (character === "<") {
        this.state = "tag";
        this.tag = "";
        this.#tagNamePending = true;
        this.#resetAttribute();
        if (!chunk.startsWith("</", index)) this.element += 1;
      }
    }
  }

  #closeValue(): void {
    this.state = "tag";
    this.#resetAttribute();
  }

  #resetAttribute(): void {
    this.attribute = "";
    this.attributeStart = -1;
    this.valueStart = false;
    this.#inUnquotedValue = false;
    this.#nameToken = "";
    this.#nameStart = -1;
  }
}

// ── attribute seat rules ───────────────────────────────────────────────────

interface AttributeSeatRule {
  readonly form: "value" | "presence";
  readonly name: string;
  readonly check?: "url" | "relative-url";
}

function attributeSeat(rawName: string, element: string, interpolation: number): AttributeSeatRule {
  const form = rawName.startsWith("?") ? ("presence" as const) : ("value" as const);
  const name = form === "presence" ? rawName.slice(1) : rawName;
  if (name === "") {
    throw new TypeError(`html: interpolation ${interpolation} binds an attribute without a name.`);
  }
  if (name.startsWith("on")) {
    throw new TypeError(
      `html: attribute ${JSON.stringify(name)} at interpolation ${interpolation} is an event ` +
        "handler; bound handlers are refused — activation belongs to asks.",
    );
  }
  if (name === "action" || name === "formaction") {
    throw new TypeError(
      `html: attribute ${JSON.stringify(name)} at interpolation ${interpolation} would route ` +
        "around the admitted ask path; bound form destinations are refused.",
    );
  }
  if (name === "style") {
    throw new TypeError(
      `html: a bound style attribute at interpolation ${interpolation} is refused; ` +
        "state variation belongs to class value seats.",
    );
  }
  if (name === "srcset") {
    throw new TypeError(
      `html: a bound srcset at interpolation ${interpolation} is not yet supported.`,
    );
  }
  if (name === "src") {
    if (element === "img") return { form, name, check: "url" };
    if (element === "iframe") return { form, name, check: "relative-url" };
    throw new TypeError(
      `html: a bound src on <${element || "?"}> at interpolation ${interpolation} is refused; ` +
        "bound sources are supported on img and iframe elements.",
    );
  }
  if (name === "href") return { form, name, check: "url" };
  return { form, name };
}

function guardElement(element: string, interpolation: number): void {
  const opened = element.startsWith("/") ? element.slice(1) : element;
  if (GUARDED_ELEMENTS.has(opened)) {
    throw new TypeError(
      `html: interpolation ${interpolation} is inside a <${opened}> element; ` +
        "bound statements there are refused.",
    );
  }
}

function attributeRef(statement: unknown, interpolation: number): RendererValueRef {
  if (typeof statement !== "symbol") {
    throw new TypeError(
      `html: interpolation ${interpolation} in an attribute seat must bind one renderer value.`,
    );
  }
  const value = currentBuildContext()?.values.get(statement);
  if (value === undefined) {
    throw new TypeError(
      `html: interpolation ${interpolation} is not a renderer value from the current declaration.`,
    );
  }
  if (value.scope === "field") {
    throw new TypeError(
      `html: field ${JSON.stringify(value.name)} at interpolation ${interpolation} ` +
        "must arm an element, not occupy text or an attribute value.",
    );
  }
  return value;
}

// ── the html tag ───────────────────────────────────────────────────────────

type HtmlPart = HtmlNode["parts"][number];

interface OpenAttribute {
  readonly rule: AttributeSeatRule;
  readonly element: number;
  readonly quote: '"' | "'";
  readonly parts: AttributeValuePart[];
}

export function html(strings: TemplateStringsArray, ...statements: readonly unknown[]): HtmlNode {
  if (strings.length !== statements.length + 1) {
    throw new TypeError("html: malformed tagged template input.");
  }
  const parts: HtmlPart[] = [];
  const scanner = new MarkupScanner();
  let openAttribute: OpenAttribute | undefined;
  let expectDelimiter = false;

  const finalizeAttribute = (open: OpenAttribute, interpolation: number): void => {
    const refs = open.parts.filter((part) => part.kind === "ref");
    const literals = open.parts.filter((part) => part.kind === "literal" && part.value !== "");
    if (open.rule.form === "presence" && (refs.length !== 1 || literals.length > 0)) {
      throw new TypeError(
        `html: presence attribute ${JSON.stringify(open.rule.name)} at interpolation ${interpolation} ` +
          "takes exactly one bound value and no literal text.",
      );
    }
    parts.push(
      Object.freeze({
        kind: "attribute" as const,
        element: open.element,
        name: open.rule.name,
        form: open.rule.form,
        ...(open.rule.check === undefined ? {} : { check: open.rule.check }),
        value: Object.freeze(
          open.parts.map((part) => Object.freeze(part)) as readonly AttributeValuePart[],
        ),
      }),
    );
  };

  for (let index = 0; index < strings.length; index += 1) {
    let literal = strings[index];

    if (expectDelimiter) {
      if (literal.length === 0 || !/[\s/>]/.test(literal[0])) {
        throw new TypeError(
          `html: interpolation ${index} must be the complete unquoted attribute value; ` +
            "quote the attribute to mix literal text with a bound value.",
        );
      }
      expectDelimiter = false;
    }

    if (openAttribute !== undefined) {
      const closing = literal.indexOf(openAttribute.quote);
      if (closing === -1) {
        if (index === statements.length) {
          throw new TypeError("html: an attribute value seat is never closed.");
        }
        if (literal !== "") openAttribute.parts.push({ kind: "literal", value: literal });
        openAttribute.parts.push({
          kind: "ref",
          ref: attributeRef(statements[index], index + 1),
        });
        continue;
      }
      if (closing > 0) {
        openAttribute.parts.push({ kind: "literal", value: literal.slice(0, closing) });
      }
      finalizeAttribute(openAttribute, index);
      openAttribute = undefined;
      literal = literal.slice(closing + 1);
      scanner.state = "tag";
    }

    scanner.scan(literal);

    if (index === statements.length) {
      parts.push(Object.freeze({ kind: "literal" as const, value: literal }));
      continue;
    }

    const statement = statements[index];
    const interpolation = index + 1;

    // Attribute seats claim the attribute's own markup from the literal.
    if (scanner.state === "tag" && scanner.valueStart) {
      if (scanner.attributeStart === -1) {
        throw new TypeError(
          `html: interpolation ${interpolation} binds an attribute whose markup opened in an ` +
            "earlier template chunk; keep an attribute's markup in one chunk.",
        );
      }
      guardElement(scanner.tag, interpolation);
      const rule = attributeSeat(scanner.attribute, scanner.tag, interpolation);
      const kept = literal.slice(0, scanner.attributeStart);
      parts.push(Object.freeze({ kind: "literal" as const, value: kept }));
      finalizeAttribute(
        {
          rule,
          element: scanner.element,
          quote: '"',
          parts: [{ kind: "ref", ref: attributeRef(statement, interpolation) }],
        },
        interpolation,
      );
      scanner.valueStart = false;
      scanner.attribute = "";
      expectDelimiter = true;
      continue;
    }
    if (scanner.state === "dquote" || scanner.state === "squote") {
      if (scanner.attributeStart === -1 || scanner.attribute === "") {
        throw new TypeError(
          `html: interpolation ${interpolation} sits inside a quoted attribute value that ` +
            "opened in an earlier template chunk; keep an attribute's markup in one chunk.",
        );
      }
      guardElement(scanner.tag, interpolation);
      const rule = attributeSeat(scanner.attribute, scanner.tag, interpolation);
      const quote = scanner.state === "dquote" ? ('"' as const) : ("'" as const);
      const quoteIndex = literal.indexOf(quote, scanner.attributeStart);
      const kept = literal.slice(0, scanner.attributeStart);
      const prefix = literal.slice(quoteIndex + 1);
      parts.push(Object.freeze({ kind: "literal" as const, value: kept }));
      openAttribute = {
        rule,
        element: scanner.element,
        quote,
        parts: prefix === "" ? [] : [{ kind: "literal", value: prefix }],
      };
      openAttribute.parts.push({
        kind: "ref",
        ref: attributeRef(statement, interpolation),
      });
      continue;
    }

    parts.push(Object.freeze({ kind: "literal" as const, value: literal }));

    if (scanner.state === "rawtext") {
      throw new TypeError(
        `html: interpolation ${interpolation} is inside a <${scanner.rawTag}> element's raw ` +
          "text; bound statements there are refused.",
      );
    }
    if (scanner.state === "tag") guardElement(scanner.tag, interpolation);

    if (typeof statement === "symbol") {
      const value = currentBuildContext()?.values.get(statement);
      if (value === undefined) {
        throw new TypeError(
          `html: interpolation ${interpolation} is not a renderer value from the current declaration.`,
        );
      }
      if (value.scope === "field") {
        if (scanner.state !== "tag") {
          throw new TypeError(
            `html: field ${JSON.stringify(value.name)} at interpolation ${interpolation} ` +
              "must arm an element, not occupy text or an attribute value.",
          );
        }
        parts.push(Object.freeze({ kind: "field" as const, field: value }));
        continue;
      }
      if (scanner.state !== "content") {
        throw new TypeError(
          `html: value ${JSON.stringify(value.name)} at interpolation ${interpolation} ` +
            "must be shown between elements, not in an element or attribute seat.",
        );
      }
      parts.push(Object.freeze({ kind: "show" as const, value }));
      continue;
    }
    if (isReadPlacement(statement)) {
      if (scanner.state !== "content") {
        throw new TypeError(
          `html: ${statement.cardinality} read at interpolation ${interpolation} must occupy a subtree place.`,
        );
      }
      parts.push(statement);
      continue;
    }
    const ask = lowerAsk(statement);
    if (ask !== undefined) {
      if (scanner.state !== "tag") {
        throw new TypeError(
          `html: ask ${ask.ask.concept}.${ask.ask.action} at interpolation ${interpolation} ` +
            "must arm an element.",
        );
      }
      parts.push(ask);
      continue;
    }
    if (isImmediateInvocation(statement)) {
      if (scanner.state !== "tag") {
        throw new TypeError(
          `html: immediate ${JSON.stringify(statement.$immediate.identity)} at interpolation ` +
            `${interpolation} must arm an element.`,
        );
      }
      parts.push(Object.freeze({ kind: "immediate" as const, invocation: statement }));
      continue;
    }
    if (!isRendererInvocation(statement)) {
      throw new TypeError(
        `html: interpolation ${interpolation} is not a checked authored statement. ` +
          "Place a renderer invocation here; computed values and callbacks are not supported.",
      );
    }
    if (scanner.state !== "content") {
      throw new TypeError(
        `html: renderer ${JSON.stringify(statement.$renderer.identity)} at interpolation ${interpolation} ` +
          "must occupy a subtree place between elements, not an element or attribute seat.",
      );
    }
    parts.push(
      Object.freeze({
        kind: "renderer" as const,
        invocation: lowerRendererInvocation(statement, interpolation),
      }),
    );
  }
  if (openAttribute !== undefined) {
    throw new TypeError("html: an attribute value seat is never closed.");
  }
  return Object.freeze({ kind: "html", parts: Object.freeze(parts) });
}

function bindingBag<T extends RendererBindings>(
  scope: "input" | "binding" | "field",
  used?: Set<string>,
  references?: RendererBuildContext["values"],
): T {
  const symbols = new Map<PropertyKey, symbol>();
  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      if (used !== undefined && typeof property === "string") used.add(property);
      let value = symbols.get(property);
      if (value === undefined) {
        value = Symbol(String(property));
        symbols.set(property, value);
        if (references !== undefined && typeof property === "string") {
          references.set(value, { scope, name: property });
        }
      }
      return value;
    },
  });
}

type AskPlacement = Extract<HtmlNode["parts"][number], { kind: "ask" }>;

function askValue(value: unknown, site: string): unknown {
  if (typeof value !== "symbol") return value;
  const reference = currentBuildContext()?.values.get(value);
  if (reference === undefined) {
    throw new TypeError(`${site} uses a value outside the renderer's scopes.`);
  }
  return reference;
}

function askSeatMapping(
  entries: Record<string, unknown>,
  role: "response" | "refusal",
): Readonly<Record<string, RendererValueRef>> {
  const mapping: Record<string, RendererValueRef> = {};
  for (const [name, entry] of Object.entries(entries)) {
    if (typeof entry !== "symbol") {
      throw new TypeError(`ask ${role} ${JSON.stringify(name)} must fill a renderer field.`);
    }
    const reference = currentBuildContext()?.values.get(entry);
    if (reference === undefined || reference.scope !== "field") {
      throw new TypeError(`ask ${role} ${JSON.stringify(name)} must use the field bag.`);
    }
    mapping[name] = reference;
  }
  return Object.freeze(mapping);
}

function lowerAsk(value: unknown): AskPlacement | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { kind?: unknown }).kind !== "step"
  ) {
    return undefined;
  }
  const step = value as {
    linePosture?: unknown;
    action?: {
      action?: { refConcept?: unknown; refAction?: unknown };
      input?: unknown;
      output?: unknown;
    };
  };
  const ref = step.action?.action;
  if (typeof ref?.refConcept !== "string" || typeof ref.refAction !== "string") {
    throw new TypeError("html: an ask needs a static concept action reference.");
  }
  if (typeof step.action?.input !== "object" || step.action.input === null) {
    throw new TypeError("html: an ask needs an action input mapping.");
  }
  const input = Object.freeze(
    Object.fromEntries(
      Object.entries(step.action.input).map(([name, entry]) => [
        name,
        askValue(entry, `ask input ${JSON.stringify(name)}`),
      ]),
    ),
  );
  // A returned-posture line (`.responds({ ... })`) routes accepted outputs into
  // held fields. A refused-posture line (`.refuses({ ... })`) routes the
  // refusal's detail into display seats. Both arm the same requested ask.
  let output: Readonly<Record<string, RendererValueRef>> = Object.freeze({});
  let refuses: Readonly<Record<string, RendererValueRef>> | undefined;
  if (step.action.output !== undefined) {
    if (typeof step.action.output !== "object" || step.action.output === null) {
      throw new TypeError("html: an ask response needs an output mapping.");
    }
    if (step.linePosture === "refused") {
      refuses = askSeatMapping(step.action.output as Record<string, unknown>, "refusal");
      if (Object.keys(refuses).length === 0) {
        throw new TypeError("html: .refuses({ ... }) needs at least one refusal seat.");
      }
    } else {
      output = askSeatMapping(step.action.output as Record<string, unknown>, "response");
    }
  } else if (step.linePosture === "refused") {
    throw new TypeError("html: .refuses({ ... }) needs at least one refusal seat.");
  }
  return Object.freeze({
    kind: "ask" as const,
    ask: Object.freeze({
      concept: ref.refConcept,
      action: ref.refAction,
      input,
      output,
      ...(refuses === undefined ? {} : { refuses }),
    }),
  });
}

type ReadPlacement = Extract<HtmlNode["parts"][number], { kind: "read" }>;

const ReadPlacements = new WeakSet<object>();

function isReadPlacement(value: unknown): value is ReadPlacement {
  return typeof value === "object" && value !== null && ReadPlacements.has(value);
}

function portableReadValue(value: unknown, site: string): unknown {
  if (typeof value !== "symbol") return value;
  const reference = currentBuildContext()?.values.get(value);
  if (reference === undefined || reference.scope === "field") {
    throw new TypeError(`${site} uses a value outside the renderer's input and read scopes.`);
  }
  return reference;
}

function lowerRendererInvocation(
  invocation: RendererInvocation,
  interpolation: number,
): RendererInvocation {
  const inputs = Object.fromEntries(
    Object.entries(invocation)
      .filter(([name]) => name !== "$renderer")
      .map(([name, value]) => [
        name,
        portableReadValue(
          value,
          `renderer ${JSON.stringify(invocation.$renderer.identity)} input ${JSON.stringify(name)} at interpolation ${interpolation}`,
        ),
      ]),
  );
  return Object.freeze({ $renderer: invocation.$renderer, ...inputs });
}

function readPlacement(
  cardinality: "each" | "where",
  line: ReadLine,
  body: HtmlNode,
): ReadPlacement {
  if (
    typeof line !== "object" ||
    line === null ||
    line.view !== undefined ||
    line.query === undefined
  ) {
    throw new TypeError(`${cardinality}(...) currently needs a concept query read.`);
  }
  if (Object.keys(line.not).length > 0) {
    throw new TypeError(`${cardinality}(...) does not yet support negated output tests.`);
  }
  const query = line.query as typeof line.query & {
    refConcept?: string;
    refQuery?: string;
    queryIdentity?: readonly string[];
  };
  if (typeof query.refConcept !== "string" || typeof query.refQuery !== "string") {
    throw new TypeError(`${cardinality}(...) needs a static concept query reference.`);
  }
  const output: Record<string, RendererValueRef> = {};
  for (const [field, value] of Object.entries(line.out)) {
    if (typeof value !== "symbol") {
      throw new TypeError(
        `${cardinality}(...) output ${JSON.stringify(field)} must bind a renderer name.`,
      );
    }
    const reference = currentBuildContext()?.values.get(value);
    if (reference === undefined || reference.scope !== "binding") {
      throw new TypeError(
        `${cardinality}(...) output ${JSON.stringify(field)} must use the binding bag.`,
      );
    }
    output[field] = reference;
  }
  const placement = Object.freeze({
    kind: "read" as const,
    cardinality,
    read: Object.freeze({
      concept: query.refConcept,
      query: query.refQuery,
      ...(query.queryIdentity === undefined ? {} : { identity: query.queryIdentity }),
      input: Object.freeze(
        Object.fromEntries(
          Object.entries(line.in).map(([name, value]) => [
            name,
            portableReadValue(value, `${cardinality}(...) input ${JSON.stringify(name)}`),
          ]),
        ),
      ),
      output: Object.freeze(output),
    }),
    body,
  });
  ReadPlacements.add(placement);
  return placement;
}

interface RendererReadBuilder {
  html(strings: TemplateStringsArray, ...statements: readonly unknown[]): ReadPlacement;
}

function readBuilder(cardinality: "each" | "where", line: ReadLine): RendererReadBuilder {
  return Object.freeze({
    html(strings: TemplateStringsArray, ...statements: readonly unknown[]) {
      return readPlacement(cardinality, line, html(strings, ...statements));
    },
  });
}

export function each(line: ReadLine): RendererReadBuilder {
  return readBuilder("each", line);
}

export function where(line: ReadLine): RendererReadBuilder {
  return readBuilder("where", line);
}

// ── refusal seat resolution ────────────────────────────────────────────────
//
// A field-bag symbol named by an ask's `.refuses({ ... })` mapping is a display
// seat, not a held draft. After the builder returns, its armed placements are
// re-kinded from field to refusal, and a name may not serve both roles.

interface SeatUsage {
  readonly refusalSeats: Set<string>;
  readonly heldFields: Set<string>;
}

function collectSeatUsage(node: HtmlNode, usage: SeatUsage): void {
  for (const part of node.parts) {
    if (part.kind === "ask") {
      for (const reference of Object.values(part.ask.refuses ?? {})) {
        usage.refusalSeats.add(reference.name);
      }
      for (const reference of Object.values(part.ask.output)) {
        usage.heldFields.add(reference.name);
      }
      for (const value of Object.values(part.ask.input)) {
        const reference = value as Partial<RendererValueRef>;
        if (reference?.scope === "field" && typeof reference.name === "string") {
          usage.heldFields.add(reference.name);
        }
      }
    } else if (part.kind === "read") {
      collectSeatUsage(part.body, usage);
    }
  }
}

function rekindRefusalSeats(node: HtmlNode, refusalSeats: ReadonlySet<string>): HtmlNode {
  let changed = false;
  const parts = node.parts.map((part) => {
    if (part.kind === "field" && refusalSeats.has(part.field.name)) {
      changed = true;
      return Object.freeze({ kind: "refusal" as const, seat: part.field });
    }
    if (part.kind === "read") {
      const body = rekindRefusalSeats(part.body, refusalSeats);
      if (body !== part.body) {
        changed = true;
        const replaced = Object.freeze({ ...part, body });
        ReadPlacements.add(replaced);
        return replaced;
      }
    }
    return part;
  });
  if (!changed) return node;
  return Object.freeze({ kind: "html" as const, parts: Object.freeze(parts) });
}

function seatIsPlaced(node: HtmlNode, name: string): boolean {
  return node.parts.some((part) => {
    if (part.kind === "refusal") return part.seat.name === name;
    if (part.kind === "read") return seatIsPlaced(part.body, name);
    return false;
  });
}

function resolveRefusalSeats(identity: string, body: HtmlNode): HtmlNode {
  const usage: SeatUsage = { refusalSeats: new Set(), heldFields: new Set() };
  collectSeatUsage(body, usage);
  if (usage.refusalSeats.size === 0) return body;
  for (const name of usage.refusalSeats) {
    if (usage.heldFields.has(name)) {
      throw new TypeError(
        `Renderer ${JSON.stringify(identity)} refusal seat ${JSON.stringify(name)} cannot also ` +
          "hold a draft or ask value; give the refusal its own seat name.",
      );
    }
  }
  const resolved = rekindRefusalSeats(body, usage.refusalSeats);
  for (const name of usage.refusalSeats) {
    if (!seatIsPlaced(resolved, name)) {
      throw new TypeError(
        `Renderer ${JSON.stringify(identity)} refusal seat ${JSON.stringify(name)} is never ` +
          "placed; arm an element with it to show the refusal.",
      );
    }
  }
  return resolved;
}

// ── immediates ─────────────────────────────────────────────────────────────
//
// An immediate declares a local consequence of an observed ask outcome. The
// declaration is realization-neutral and carries no code; a realization binds
// the implementation by canonical identity. Invoking a declared immediate in a
// renderer arms an element with inert identity-and-args data.

const Immediates = new WeakSet<object>();

function immediateFieldRef(value: unknown, site: string): RendererValueRef {
  if (typeof value !== "symbol") {
    throw new TypeError(`${site} must name a renderer field.`);
  }
  const reference = currentBuildContext()?.values.get(value);
  if (reference === undefined || reference.scope !== "field") {
    throw new TypeError(`${site} must use the field bag.`);
  }
  return reference;
}

export function immediate(
  description: string,
  contract: { readonly on: ImmediateTrigger } & Record<string, unknown>,
): Immediate {
  if (description.trim() === "") {
    throw new TypeError("immediate(...) needs a human description.");
  }
  const { on, ...argKinds } = contract;
  if (on !== "accepted" && on !== "refused") {
    throw new TypeError('immediate(...) needs an "on" trigger: "accepted" or "refused".');
  }
  const declaredArgs: Record<string, ImmediateArgKind> = {};
  for (const [name, kind] of Object.entries(argKinds)) {
    const isMany =
      typeof kind === "object" && kind !== null && (kind as { many?: unknown }).many === "field";
    if (kind !== "field" && !isMany) {
      throw new TypeError(
        `immediate(...) argument ${JSON.stringify(name)} needs the kind "field" or many("field").`,
      );
    }
    declaredArgs[name] = isMany ? Object.freeze({ many: "field" as const }) : "field";
  }

  let identity: string | undefined;
  let declaration: ImmediateDeclaration | undefined;
  const declared = ((args: Record<string, unknown>) => {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new TypeError("An immediate invocation needs an argument mapping.");
    }
    const installed = declared.declaration;
    const resolved: Record<string, RendererValueRef | readonly RendererValueRef[]> = {};
    for (const [name, kind] of Object.entries(installed.contract)) {
      if (!Object.hasOwn(args, name)) {
        throw new TypeError(
          `Immediate ${JSON.stringify(installed.identity)} omitted declared argument ${JSON.stringify(name)}.`,
        );
      }
      const site = `immediate ${JSON.stringify(installed.identity)} argument ${JSON.stringify(name)}`;
      const value = args[name];
      if (kind === "field") {
        resolved[name] = immediateFieldRef(value, site);
      } else {
        if (!Array.isArray(value)) {
          throw new TypeError(`${site} must name a list of renderer fields.`);
        }
        resolved[name] = Object.freeze(value.map((entry) => immediateFieldRef(entry, site)));
      }
    }
    for (const name of Object.keys(args)) {
      if (!Object.hasOwn(installed.contract, name)) {
        throw new TypeError(
          `Immediate ${JSON.stringify(installed.identity)} received undeclared argument ${JSON.stringify(name)}.`,
        );
      }
    }
    return Object.freeze({ $immediate: installed, args: Object.freeze(resolved) });
  }) as Immediate;

  interfaceDeclaration(declared, (installed) => {
    if (identity !== undefined && identity !== installed) {
      throw new Error(
        `immediate: one declaration cannot be installed as both ${JSON.stringify(identity)} and ${JSON.stringify(installed)}.`,
      );
    }
    identity = installed;
  });

  Object.defineProperty(declared, "declaration", {
    enumerable: true,
    get() {
      if (identity === undefined) {
        throw new Error(
          `immediate: ${JSON.stringify(description)} must be a canonical top-level interface export before it is invoked.`,
        );
      }
      declaration ??= Object.freeze({
        format: "sync-engine.immediate" as const,
        version: 1 as const,
        identity,
        description,
        on,
        contract: Object.freeze(declaredArgs),
      });
      return declaration;
    },
  });

  Immediates.add(declared);
  return declared;
}

export function isImmediate(value: unknown): value is Immediate {
  return typeof value === "function" && Immediates.has(value);
}

export function isImmediateInvocation(value: unknown): value is ImmediateInvocation {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "$immediate")) {
    return false;
  }
  const declaration = (value as { $immediate?: unknown }).$immediate;
  if (typeof declaration !== "object" || declaration === null) return false;
  const candidate = declaration as Partial<ImmediateDeclaration>;
  if (
    candidate.format !== "sync-engine.immediate" ||
    candidate.version !== 1 ||
    typeof candidate.identity !== "string" ||
    typeof candidate.description !== "string" ||
    (candidate.on !== "accepted" && candidate.on !== "refused") ||
    typeof candidate.contract !== "object" ||
    candidate.contract === null
  ) {
    return false;
  }
  const args = (value as { args?: unknown }).args;
  if (typeof args !== "object" || args === null) return false;
  return Object.values(args).every((entry) =>
    Array.isArray(entry)
      ? entry.every((ref) => isRendererValueRef(ref) && ref.scope === "field")
      : isRendererValueRef(entry) && (entry as RendererValueRef).scope === "field",
  );
}

export function renderer(
  description: string,
  build: RendererBuilder<OpenRendererBag, OpenRendererBag, OpenRendererBag>,
): Renderer<RendererInputs>;
export function renderer<
  Inputs extends RendererInputs,
  Bindings extends RendererBindings = Record<string, never>,
  Fields extends RendererBindings = Record<string, never>,
>(description: string, build: RendererBuilder<Inputs, Bindings, Fields>): Renderer<Inputs>;
export function renderer<
  Inputs extends RendererInputs = Record<string, never>,
  Bindings extends RendererBindings = Record<string, never>,
  Fields extends RendererBindings = Record<string, never>,
>(description: string, build: RendererBuilder<Inputs, Bindings, Fields>): Renderer<Inputs> {
  if (description.trim() === "") {
    throw new TypeError("renderer(...) needs a human description.");
  }
  if (typeof build !== "function") {
    throw new TypeError("renderer(...) needs a builder closure.");
  }

  let identity: string | undefined;
  let declaration: RendererDeclaration | undefined;
  const declared = ((inputs: Inputs) => {
    if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
      throw new TypeError("A renderer invocation needs a caller-input mapping.");
    }
    if (Object.hasOwn(inputs, "$renderer")) {
      throw new TypeError('A renderer caller input cannot be named "$renderer".');
    }
    const installed = declared.declaration;
    const supplied = Object.keys(inputs).sort((left, right) => left.localeCompare(right));
    const undeclared = supplied.filter((name) => !installed.inputs.includes(name));
    const missing = installed.inputs.filter((name) => !Object.hasOwn(inputs, name));
    if (undeclared.length > 0) {
      throw new TypeError(
        `Renderer ${JSON.stringify(installed.identity)} caller supplied undeclared input ${JSON.stringify(undeclared[0])}. ` +
          `Declared caller inputs: ${installed.inputs.length === 0 ? "none" : installed.inputs.join(", ")}.`,
      );
    }
    if (missing.length > 0) {
      throw new TypeError(
        `Renderer ${JSON.stringify(installed.identity)} caller omitted declared input ${JSON.stringify(missing[0])}.`,
      );
    }
    return Object.freeze({
      $renderer: installed,
      ...inputs,
    }) as RendererInvocation<Inputs>;
  }) as Renderer<Inputs>;

  interfaceDeclaration(declared, (installed) => {
    if (identity !== undefined && identity !== installed) {
      throw new Error(
        `renderer: one declaration cannot be installed as both ${JSON.stringify(identity)} and ${JSON.stringify(installed)}.`,
      );
    }
    identity = installed;
  });

  Object.defineProperty(declared, "declaration", {
    enumerable: true,
    get() {
      if (identity === undefined) {
        throw new Error(
          `renderer: ${JSON.stringify(description)} must be a canonical top-level interface export before it is invoked.`,
        );
      }
      if (declaration === undefined) {
        const callerInputs = new Set<string>();
        const context: RendererBuildContext = { values: new Map() };
        RendererBuildContexts.push(context);
        let body: RenderingNode;
        try {
          body = build(
            bindingBag<Inputs>("input", callerInputs, context.values),
            bindingBag<Bindings>("binding", undefined, context.values),
            bindingBag<Fields>("field", undefined, context.values),
          );
        } finally {
          RendererBuildContexts.pop();
        }
        if (callerInputs.has("$renderer")) {
          throw new TypeError('A renderer caller input cannot be named "$renderer".');
        }
        if (body === null || typeof body !== "object" || body.kind !== "html") {
          throw new TypeError(`Renderer ${JSON.stringify(identity)} must return a rendering node.`);
        }
        declaration = Object.freeze({
          format: "sync-engine.renderer" as const,
          version: 1 as const,
          identity,
          description,
          inputs: Object.freeze([...callerInputs].sort((left, right) => left.localeCompare(right))),
          body: resolveRefusalSeats(identity, body),
        });
      }
      return declaration;
    },
  });

  Renderers.add(declared);
  return declared;
}

export function isRenderer(value: unknown): value is Renderer {
  return typeof value === "function" && Renderers.has(value);
}

export function isRendererInvocation(value: unknown): value is RendererInvocation {
  return isRendererInvocationValue(value, new Set<object>());
}

function isRendererInvocationValue(value: unknown, seen: Set<object>): value is RendererInvocation {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "$renderer")) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  const declaration = (value as { $renderer?: unknown }).$renderer;
  if (typeof declaration !== "object" || declaration === null) return false;
  const candidate = declaration as Partial<RendererDeclaration>;
  if (
    candidate.format !== "sync-engine.renderer" ||
    candidate.version !== 1 ||
    typeof candidate.identity !== "string" ||
    typeof candidate.description !== "string" ||
    !Array.isArray(candidate.inputs) ||
    !candidate.inputs.every((input) => typeof input === "string") ||
    typeof candidate.body !== "object" ||
    candidate.body === null
  ) {
    return false;
  }
  const body = candidate.body as Partial<HtmlNode>;
  if (body.kind !== "html" || !Array.isArray(body.parts)) return false;
  if (!isPortableHtmlNode(body as HtmlNode, candidate.inputs, seen)) return false;
  const declaredInputs = [...candidate.inputs].sort((left, right) => left.localeCompare(right));
  if (new Set(declaredInputs).size !== declaredInputs.length) return false;
  if (!declaredInputs.every((input, index) => input === candidate.inputs?.[index])) return false;
  const suppliedInputs = Object.keys(value)
    .filter((input) => input !== "$renderer")
    .sort((left, right) => left.localeCompare(right));
  return (
    suppliedInputs.length === declaredInputs.length &&
    suppliedInputs.every((input, index) => input === declaredInputs[index])
  );
}

function isRendererValueRef(value: unknown): value is RendererValueRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RendererValueRef>;
  return (
    (candidate.scope === "input" || candidate.scope === "binding" || candidate.scope === "field") &&
    typeof candidate.name === "string"
  );
}

function isPortableReadPlacement(
  value: ReadPlacement,
  inputs: readonly string[],
  seen: Set<object>,
): boolean {
  if (value.cardinality !== "each" && value.cardinality !== "where") return false;
  const read = value.read as Partial<RendererRead>;
  if (
    typeof read.concept !== "string" ||
    typeof read.query !== "string" ||
    typeof read.input !== "object" ||
    read.input === null ||
    typeof read.output !== "object" ||
    read.output === null ||
    value.body?.kind !== "html"
  ) {
    return false;
  }
  for (const input of Object.values(read.input)) {
    if (isRendererValueRef(input)) {
      if (input.scope === "field") return false;
      if (input.scope === "input" && !inputs.includes(input.name)) return false;
    }
  }
  if (
    !Object.values(read.output).every(
      (output) => isRendererValueRef(output) && output.scope === "binding",
    )
  ) {
    return false;
  }
  return isPortableHtmlNode(value.body, inputs, seen);
}

function isPortableAsk(ask: RendererAsk, inputs: readonly string[]): boolean {
  if (
    typeof ask.concept !== "string" ||
    typeof ask.action !== "string" ||
    typeof ask.input !== "object" ||
    ask.input === null ||
    typeof ask.output !== "object" ||
    ask.output === null
  ) {
    return false;
  }
  for (const input of Object.values(ask.input)) {
    if (isRendererValueRef(input) && input.scope === "input" && !inputs.includes(input.name)) {
      return false;
    }
  }
  if (
    !Object.values(ask.output).every(
      (output) => isRendererValueRef(output) && output.scope === "field",
    )
  ) {
    return false;
  }
  if (ask.refuses !== undefined) {
    if (typeof ask.refuses !== "object" || ask.refuses === null) return false;
    if (
      !Object.values(ask.refuses).every(
        (seat) => isRendererValueRef(seat) && seat.scope === "field",
      )
    ) {
      return false;
    }
  }
  return true;
}

function isPortableAttributeValue(
  parts: readonly AttributeValuePart[],
  inputs: readonly string[],
): boolean {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  return parts.every((part) => {
    if (typeof part !== "object" || part === null) return false;
    if (part.kind === "literal") return typeof part.value === "string";
    if (part.kind !== "ref" || !isRendererValueRef(part.ref)) return false;
    if (part.ref.scope === "field") return false;
    if (part.ref.scope === "input" && !inputs.includes(part.ref.name)) return false;
    return true;
  });
}

function isPortableHtmlNode(node: HtmlNode, inputs: readonly string[], seen: Set<object>): boolean {
  for (const part of node.parts) {
    if (typeof part !== "object" || part === null) return false;
    if (part.kind === "literal") {
      if (typeof part.value !== "string") return false;
    } else if (part.kind === "show") {
      if (!isRendererValueRef(part.value)) return false;
      if (part.value.scope === "field") return false;
      if (part.value.scope === "input" && !inputs.includes(part.value.name)) return false;
    } else if (part.kind === "field") {
      if (!isRendererValueRef(part.field) || part.field.scope !== "field") return false;
    } else if (part.kind === "refusal") {
      if (!isRendererValueRef(part.seat) || part.seat.scope !== "field") return false;
    } else if (part.kind === "attribute") {
      if (typeof part.element !== "number" || typeof part.name !== "string") return false;
      if (part.form !== "value" && part.form !== "presence") return false;
      if (part.check !== undefined && part.check !== "url" && part.check !== "relative-url") {
        return false;
      }
      if (!isPortableAttributeValue(part.value, inputs)) return false;
      if (part.form === "presence") {
        const refs = part.value.filter((entry) => entry.kind === "ref");
        const literals = part.value.filter(
          (entry) => entry.kind === "literal" && entry.value !== "",
        );
        if (refs.length !== 1 || literals.length > 0) return false;
      }
    } else if (part.kind === "ask") {
      if (!isPortableAsk(part.ask, inputs)) return false;
    } else if (part.kind === "immediate") {
      if (!isImmediateInvocation(part.invocation)) return false;
    } else if (part.kind === "read") {
      if (!isPortableReadPlacement(part, inputs, seen)) return false;
    } else if (part.kind === "renderer") {
      for (const [name, value] of Object.entries(part.invocation)) {
        if (name === "$renderer") continue;
        if (typeof value === "symbol") return false;
        if (isRendererValueRef(value)) {
          if (value.scope === "field") return false;
          if (value.scope === "input" && !inputs.includes(value.name)) return false;
        }
      }
      if (!isRendererInvocationValue(part.invocation, new Set(seen))) return false;
    } else {
      return false;
    }
  }
  return true;
}
