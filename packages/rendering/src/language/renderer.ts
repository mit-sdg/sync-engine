import { interfaceDeclaration } from "@mit-sdg/sync-engine/advanced";

export type RendererInputs = Record<string, unknown>;
export type RendererBindings = Record<string, unknown>;

export interface HtmlNode {
  readonly kind: "html";
  readonly parts: readonly (
    | { readonly kind: "literal"; readonly value: string }
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

function bindingBag<T extends RendererBindings>(used?: Set<string>): T {
  const values = new Map<PropertyKey, symbol>();
  return new Proxy(Object.create(null) as T, {
    get(_target, property) {
      if (used !== undefined && typeof property === "string") used.add(property);
      let value = values.get(property);
      if (value === undefined) {
        value = Symbol(String(property));
        values.set(property, value);
      }
      return value;
    },
  });
}

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
        const body = build(
          bindingBag<Inputs>(callerInputs),
          bindingBag<Bindings>(),
          bindingBag<Fields>(),
        );
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
  for (const part of body.parts) {
    if (typeof part !== "object" || part === null) return false;
    const candidatePart = part as HtmlNode["parts"][number];
    if (candidatePart.kind === "literal") {
      if (typeof candidatePart.value !== "string") return false;
    } else if (candidatePart.kind === "renderer") {
      if (!isRendererInvocationValue(candidatePart.invocation, new Set(seen))) return false;
    } else {
      return false;
    }
  }
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
