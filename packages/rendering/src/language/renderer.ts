export type RendererInputs = Record<string, unknown>;

export interface HtmlNode {
  readonly kind: "html";
  readonly value: string;
}

export type RenderingNode = HtmlNode;

export interface RendererDeclaration {
  readonly format: "sync-engine.renderer";
  readonly version: 1;
  readonly name: string;
  readonly body: RenderingNode;
}

export type RendererInvocation<Inputs extends RendererInputs = RendererInputs> = {
  readonly $renderer: RendererDeclaration;
} & Inputs;

export interface Renderer<Inputs extends RendererInputs = RendererInputs> {
  (inputs: Inputs): RendererInvocation<Inputs>;
  readonly declaration: RendererDeclaration;
}

export function html(strings: TemplateStringsArray): HtmlNode {
  if (strings.length !== 1) {
    throw new TypeError("html templates do not support interpolations yet.");
  }
  return Object.freeze({ kind: "html", value: strings[0] });
}

export function renderer<Inputs extends RendererInputs = Record<string, never>>(
  name: string,
  body: RenderingNode,
): Renderer<Inputs> {
  if (name.trim() === "") throw new TypeError("renderer(...) needs a name.");
  const declarationBody = Object.freeze({ kind: body.kind, value: body.value });
  const declaration = Object.freeze({
    format: "sync-engine.renderer" as const,
    version: 1 as const,
    name,
    body: declarationBody,
  });
  const declared = ((inputs: Inputs) => {
    if (Object.hasOwn(inputs, "$renderer")) {
      throw new TypeError('A renderer caller input cannot be named "$renderer".');
    }
    return Object.freeze({ $renderer: declaration, ...inputs }) as RendererInvocation<Inputs>;
  }) as Renderer<Inputs>;
  Object.defineProperty(declared, "declaration", { value: declaration, enumerable: true });
  return declared;
}

export function isRendererInvocation(value: unknown): value is RendererInvocation {
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, "$renderer")) {
    return false;
  }
  const declaration = (value as { $renderer?: unknown }).$renderer;
  if (typeof declaration !== "object" || declaration === null) return false;
  const candidate = declaration as Partial<RendererDeclaration>;
  if (
    candidate.format !== "sync-engine.renderer" ||
    candidate.version !== 1 ||
    typeof candidate.name !== "string" ||
    typeof candidate.body !== "object" ||
    candidate.body === null
  ) {
    return false;
  }
  const body = candidate.body as Partial<HtmlNode>;
  return body.kind === "html" && typeof body.value === "string";
}
