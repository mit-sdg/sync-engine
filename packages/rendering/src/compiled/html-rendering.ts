import type { InterfaceBinding } from "@mit-sdg/sync-engine/boundary";
import {
  isRenderer,
  isRendererInvocation,
  type HtmlNode,
  type RendererDeclaration,
  type RendererInvocation,
} from "../language/renderer.ts";

export interface FormedHtmlContent {
  readonly format: "html";
  readonly value: string;
}

export interface FormedHtml {
  readonly holder: string;
  readonly content: FormedHtmlContent;
}

export interface CompiledHtmlRendering {
  readonly interface: string;
  readonly renderers: readonly string[];
  form(invocation: RendererInvocation): FormedHtml;
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

  const formNode = (node: HtmlNode): string =>
    node.parts
      .map((part) =>
        part.kind === "literal"
          ? part.value
          : formNode(canonical(part.invocation.$renderer.identity).body),
      )
      .join("");

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
    form(invocation: RendererInvocation): FormedHtml {
      if (!isRendererInvocation(invocation)) {
        throw new TypeError("compileHtml.form: endpoint did not return a renderer invocation.");
      }
      const identity = invocation.$renderer.identity;
      validateInvocation(invocation, "endpoint answer");
      const declaration = canonical(identity);
      return Object.freeze({
        holder: `${identity}:root`,
        content: Object.freeze({ format: "html" as const, value: formNode(declaration.body) }),
      });
    },
  });
}
