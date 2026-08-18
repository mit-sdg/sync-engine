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
}

export interface RendererRead {
  readonly concept: string;
  readonly query: string;
  /** Result fields whose values identify rows, as promised by the query declaration. */
  readonly identity?: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, RendererValueRef>>;
}

export interface HtmlNode {
  readonly kind: "html";
  readonly parts: readonly (
    | { readonly kind: "literal"; readonly value: string }
    | { readonly kind: "show"; readonly value: RendererValueRef }
    | { readonly kind: "field"; readonly field: RendererValueRef }
    | { readonly kind: "ask"; readonly ask: RendererAsk }
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

type MarkupState =
  | "content"
  | "tag"
  | "single-quoted-attribute"
  | "double-quoted-attribute"
  | "comment";

function scanMarkup(initial: MarkupState, markup: string): MarkupState {
  let state = initial;
  for (let index = 0; index < markup.length; index += 1) {
    const character = markup[index];
    if (state === "comment") {
      if (markup.startsWith("-->", index)) {
        state = "content";
        index += 2;
      }
      continue;
    }
    if (state === "single-quoted-attribute") {
      if (character === "'") state = "tag";
      continue;
    }
    if (state === "double-quoted-attribute") {
      if (character === '"') state = "tag";
      continue;
    }
    if (state === "tag") {
      if (character === "'") state = "single-quoted-attribute";
      else if (character === '"') state = "double-quoted-attribute";
      else if (character === ">") state = "content";
      continue;
    }
    if (markup.startsWith("<!--", index)) {
      state = "comment";
      index += 3;
    } else if (character === "<") {
      state = "tag";
    }
  }
  return state;
}

export function html(strings: TemplateStringsArray, ...statements: readonly unknown[]): HtmlNode {
  if (strings.length !== statements.length + 1) {
    throw new TypeError("html: malformed tagged template input.");
  }
  const parts: Array<HtmlNode["parts"][number]> = [];
  let state: MarkupState = "content";
  for (let index = 0; index < strings.length; index += 1) {
    const literal = strings[index];
    parts.push(Object.freeze({ kind: "literal" as const, value: literal }));
    state = scanMarkup(state, literal);
    if (index === statements.length) continue;

    const statement = statements[index];
    if (typeof statement === "symbol") {
      const value = currentBuildContext()?.values.get(statement);
      if (value === undefined) {
        throw new TypeError(
          `html: interpolation ${index + 1} is not a renderer value from the current declaration.`,
        );
      }
      if (value.scope === "field") {
        if (state !== "tag") {
          throw new TypeError(
            `html: field ${JSON.stringify(value.name)} at interpolation ${index + 1} ` +
              "must arm an element, not occupy text or an attribute value.",
          );
        }
        parts.push(Object.freeze({ kind: "field" as const, field: value }));
        continue;
      }
      if (state !== "content") {
        throw new TypeError(
          `html: value ${JSON.stringify(value.name)} at interpolation ${index + 1} ` +
            "must be shown between elements, not in an element or attribute seat.",
        );
      }
      parts.push(Object.freeze({ kind: "show" as const, value }));
      continue;
    }
    if (isReadPlacement(statement)) {
      if (state !== "content") {
        throw new TypeError(
          `html: ${statement.cardinality} read at interpolation ${index + 1} must occupy a subtree place.`,
        );
      }
      parts.push(statement);
      continue;
    }
    const ask = lowerAsk(statement);
    if (ask !== undefined) {
      if (state !== "tag") {
        throw new TypeError(
          `html: ask ${ask.ask.concept}.${ask.ask.action} at interpolation ${index + 1} ` +
            "must arm an element.",
        );
      }
      parts.push(ask);
      continue;
    }
    if (!isRendererInvocation(statement)) {
      throw new TypeError(
        `html: interpolation ${index + 1} is not a checked authored statement. ` +
          "Place a renderer invocation here; computed values and callbacks are not supported.",
      );
    }
    if (state !== "content") {
      throw new TypeError(
        `html: renderer ${JSON.stringify(statement.$renderer.identity)} at interpolation ${index + 1} ` +
          "must occupy a subtree place between elements, not an element or attribute seat.",
      );
    }
    parts.push(Object.freeze({ kind: "renderer" as const, invocation: statement }));
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
  if (step.linePosture === "refused") {
    throw new TypeError("html: an ask cannot use a refused action line.");
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
  const output: Record<string, RendererValueRef> = {};
  if (step.action.output !== undefined) {
    if (typeof step.action.output !== "object" || step.action.output === null) {
      throw new TypeError("html: an ask response needs an output mapping.");
    }
    for (const [name, entry] of Object.entries(step.action.output)) {
      if (typeof entry !== "symbol") {
        throw new TypeError(`ask output ${JSON.stringify(name)} must fill a renderer field.`);
      }
      const reference = currentBuildContext()?.values.get(entry);
      if (reference === undefined || reference.scope !== "field") {
        throw new TypeError(`ask output ${JSON.stringify(name)} must use the field bag.`);
      }
      output[name] = reference;
    }
  }
  return Object.freeze({
    kind: "ask" as const,
    ask: Object.freeze({
      concept: ref.refConcept,
      action: ref.refAction,
      input,
      output: Object.freeze(output),
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
          body,
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
  return Object.values(ask.output).every(
    (output) => isRendererValueRef(output) && output.scope === "field",
  );
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
    } else if (part.kind === "ask") {
      if (!isPortableAsk(part.ask, inputs)) return false;
    } else if (part.kind === "read") {
      if (!isPortableReadPlacement(part, inputs, seen)) return false;
    } else if (part.kind === "renderer") {
      if (!isRendererInvocationValue(part.invocation, new Set(seen))) return false;
    } else {
      return false;
    }
  }
  return true;
}
