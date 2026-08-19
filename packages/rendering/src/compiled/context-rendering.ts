import type { InterfaceBinding } from "@mit-sdg/sync-engine/boundary";
import {
  isRenderer,
  isRendererInvocation,
  type ContextNode,
  type RendererAsk,
  type RendererDeclaration,
  type RendererInvocation,
  type RendererValueRef,
} from "../language/renderer.ts";
import type { FormedRead, RenderingReader } from "./html-rendering.ts";
import { canonicalPortable, identifyRow, samePortableValue } from "./shared.ts";

/**
 * One resolved argument of a formed context ask: a value fixed by the
 * formation, or a blank the participant supplies atomically at ask time.
 */
export type FormedContextAskInput =
  | { readonly source: "blank"; readonly name: string }
  | { readonly source: "value"; readonly value: unknown };

/**
 * A registered ask carried generically by the formed unit. Provider tool
 * names, parameter schemas, and wire shapes are adapter work; an edge answers
 * by the opaque `id` plus one string per named blank.
 */
export interface FormedContextAsk {
  readonly id: string;
  readonly concept: string;
  readonly action: string;
  readonly input: Readonly<Record<string, FormedContextAskInput>>;
  readonly blanks: readonly string[];
}

export interface FormedContextSource {
  readonly kind: "renderer" | "read" | "row" | "show" | "ask";
  readonly address: string;
  readonly identity: string;
}

/**
 * The exact formed participant-context unit: readable text, its generic ask
 * set, the read footprint that keeps it current, and the sources responsible
 * for each addressed segment. The revision identifies this exact formation
 * for evidence; a call record references it rather than replacing it.
 */
export interface FormedContext {
  readonly holder: string;
  readonly revision: string;
  readonly text: string;
  readonly asks: readonly FormedContextAsk[];
  readonly reads: readonly FormedRead[];
  readonly sources: readonly FormedContextSource[];
}

export interface CompiledContextRendering {
  readonly interface: string;
  readonly renderers: readonly string[];
  form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedContext>;
}

interface Scope {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly bindings: Readonly<Record<string, unknown>>;
}

interface Formation {
  readonly asks: FormedContextAsk[];
  readonly reads: FormedRead[];
  readonly sources: FormedContextSource[];
}

function revisionOf(value: unknown): string {
  const text = JSON.stringify(canonicalPortable(value, "formation"));
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `context-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function valueRef(value: unknown): value is RendererValueRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RendererValueRef>;
  return (
    (candidate.scope === "input" || candidate.scope === "binding" || candidate.scope === "field") &&
    typeof candidate.name === "string"
  );
}

/** Compile the context renderer closure admitted by one named interface. */
export function compileContext(binding: InterfaceBinding): CompiledContextRendering {
  const admitted = new Set<string>();
  for (const dependencies of Object.values(binding.dependencies)) {
    for (const dependency of dependencies) {
      if (!isRenderer(dependency.value)) {
        throw new TypeError(
          `compileContext: dependency ${JSON.stringify(dependency.identity)} is not a renderer declaration.`,
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
        `compileContext: renderer ${JSON.stringify(identity)} is not admitted by interface ${JSON.stringify(binding.identity)}.`,
      );
    }
    const assembled = binding.declarations[identity];
    if (assembled === undefined || !isRenderer(assembled.value)) {
      throw new TypeError(
        `compileContext: renderer ${JSON.stringify(identity)} has no canonical declaration.`,
      );
    }
    return assembled.value.declaration;
  };

  const validateInvocation = (invocation: RendererInvocation, path: string): void => {
    if (!isRendererInvocation(invocation)) {
      throw new TypeError(`compileContext: ${path} is not a portable renderer invocation.`);
    }
    const identity = invocation.$renderer.identity;
    const declaration = canonical(identity);
    if (declaration.body.kind !== "context") {
      throw new TypeError(
        `compileContext: renderer ${JSON.stringify(identity)} at ${path} uses the ${declaration.body.kind} family.`,
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
        `compileContext: renderer ${JSON.stringify(identity)} at ${path} does not match its assembled declaration.`,
      );
    }
  };

  const resolve = (value: unknown, scope: Scope): unknown => {
    if (!valueRef(value)) return value;
    if (value.scope === "input") return scope.inputs[value.name];
    if (value.scope === "binding") return scope.bindings[value.name];
    return value;
  };

  const shownText = (value: unknown, address: string): string => {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    throw new TypeError(
      `compileContext.form: show at ${address} needs a string or finite number; got ${typeof value}. ` +
        "Projecting structure into text is a deliberate authoring act.",
    );
  };

  const formAsk = (ask: RendererAsk, scope: Scope, id: string): FormedContextAsk => {
    const input: Record<string, FormedContextAskInput> = {};
    const blanks: string[] = [];
    for (const [name, value] of Object.entries(ask.input)) {
      if (valueRef(value) && value.scope === "field") {
        input[name] = { source: "blank", name: value.name };
        if (!blanks.includes(value.name)) blanks.push(value.name);
      } else {
        input[name] = { source: "value", value: resolve(value, scope) };
      }
    }
    return Object.freeze({
      id,
      concept: ask.concept,
      action: ask.action,
      input: Object.freeze(input),
      blanks: Object.freeze(blanks),
    });
  };

  const formNode = async (
    node: ContextNode,
    scope: Scope,
    formation: Formation,
    address: string,
    reader?: RenderingReader,
  ): Promise<string> => {
    const pieces: string[] = [];
    for (let index = 0; index < node.parts.length; index += 1) {
      const part = node.parts[index];
      const seat = `${address}/${index}`;
      if (part.kind === "literal") {
        pieces.push(part.value);
      } else if (part.kind === "show") {
        const showAddress = `${seat}/show`;
        pieces.push(shownText(resolve(part.value, scope), showAddress));
        formation.sources.push(
          Object.freeze({ kind: "show", address: showAddress, identity: part.value.name }),
        );
      } else if (part.kind === "ask") {
        const id = `${seat}/ask`;
        formation.asks.push(formAsk(part.ask, scope, id));
        formation.sources.push(
          Object.freeze({
            kind: "ask",
            address: id,
            identity: `${part.ask.concept}.${part.ask.action}`,
          }),
        );
      } else if (part.kind === "renderer") {
        const declaration = canonical(part.invocation.$renderer.identity);
        if (declaration.body.kind !== "context") {
          throw new TypeError(
            `compileContext.form: renderer ${JSON.stringify(declaration.identity)} uses the ${declaration.body.kind} family.`,
          );
        }
        const inputs = Object.fromEntries(
          declaration.inputs.map((name) => [name, resolve(part.invocation[name], scope)]),
        );
        const childAddress = `${seat}/renderer`;
        formation.sources.push(
          Object.freeze({
            kind: "renderer",
            address: childAddress,
            identity: declaration.identity,
          }),
        );
        pieces.push(
          await formNode(
            declaration.body,
            { inputs, bindings: {} },
            formation,
            childAddress,
            reader,
          ),
        );
      } else {
        if (reader === undefined) {
          throw new TypeError("compileContext.form: a renderer read needs a RenderingReader.");
        }
        const clauseAddress = `${seat}/read`;
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
        formation.sources.push(
          Object.freeze({
            kind: "read",
            address: clauseAddress,
            identity: `${part.read.concept}.${part.read.query}`,
          }),
        );
        const answer = await reader.read(part.read, input);
        if (!Array.isArray(answer)) {
          throw new TypeError(
            `compileContext.form: ${part.read.concept}.${part.read.query} did not answer rows.`,
          );
        }
        const rows = part.cardinality === "where" ? answer.slice(0, 1) : answer;
        const identities = new Set<string>();
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const row = rows[rowIndex];
          if (typeof row !== "object" || row === null || Array.isArray(row)) {
            throw new TypeError(
              `compileContext.form: ${part.read.concept}.${part.read.query} answered a malformed row.`,
            );
          }
          const record = row as Record<string, unknown>;
          const { segment, key } = identifyRow(
            part.read,
            part.cardinality,
            record,
            rowIndex,
            identities,
            "compileContext.form",
          );
          const rowAddress = `${clauseAddress}/${segment}`;
          formation.sources.push(
            Object.freeze({ kind: "row", address: rowAddress, identity: key ?? segment }),
          );
          const bindings: Record<string, unknown> = { ...scope.bindings };
          for (const [field, reference] of Object.entries(part.read.output)) {
            bindings[reference.name] = record[field];
          }
          pieces.push(
            await formNode(part.body, { ...scope, bindings }, formation, rowAddress, reader),
          );
        }
      }
    }
    return pieces.join("");
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
    async form(invocation: RendererInvocation, reader?: RenderingReader): Promise<FormedContext> {
      if (!isRendererInvocation(invocation)) {
        throw new TypeError("compileContext.form: the root is not a renderer invocation.");
      }
      validateInvocation(invocation, "formation root");
      const declaration = canonical(invocation.$renderer.identity);
      if (declaration.body.kind !== "context") {
        throw new TypeError(
          `compileContext.form: renderer ${JSON.stringify(declaration.identity)} uses the ${declaration.body.kind} family.`,
        );
      }
      const inputs = Object.fromEntries(
        declaration.inputs.map((name) => [
          name,
          (invocation as Readonly<Record<string, unknown>>)[name],
        ]),
      );
      // The unit is identified by its root invocation: canonical renderer
      // identity plus resolved caller inputs, never a transport address.
      const holder = `${declaration.identity}(${JSON.stringify(canonicalPortable(inputs, "unit inputs"))})`;
      const formation: Formation = { asks: [], reads: [], sources: [] };
      formation.sources.push(
        Object.freeze({ kind: "renderer", address: "root", identity: declaration.identity }),
      );
      const assembled = await formNode(
        declaration.body,
        { inputs, bindings: {} },
        formation,
        "root",
        reader,
      );
      // Composition concatenates dedented templates, so empty clauses and row
      // boundaries can stack blank lines; the formed unit keeps at most one
      // blank line between blocks and one terminating newline.
      const text = assembled
        .replaceAll(/\n{3,}/g, "\n\n")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n");
      const evidence = {
        holder,
        text,
        asks: formation.asks,
        sources: formation.sources,
      };
      return Object.freeze({
        holder,
        revision: revisionOf(evidence),
        text,
        asks: Object.freeze([...formation.asks]),
        reads: Object.freeze([...formation.reads]),
        sources: Object.freeze([...formation.sources]),
      });
    },
  });
}

/**
 * Validate one edge-supplied blank mapping against a formed ask and return the
 * exact registered action input. Resolution is by the ask's opaque formed
 * identity; nothing parses an address.
 */
export function resolveContextAsk(
  formed: FormedContext,
  askId: string,
  supplied: Readonly<Record<string, unknown>>,
): { readonly ask: FormedContextAsk; readonly input: Readonly<Record<string, unknown>> } {
  const ask = formed.asks.find((candidate) => candidate.id === askId);
  if (ask === undefined) {
    throw new TypeError(`resolveContextAsk: unknown ask ${JSON.stringify(askId)}.`);
  }
  const unknown = Object.keys(supplied).find((name) => !ask.blanks.includes(name));
  if (unknown !== undefined) {
    throw new TypeError(
      `resolveContextAsk: ${ask.concept}.${ask.action} received unknown blank ${JSON.stringify(unknown)}.`,
    );
  }
  for (const name of ask.blanks) {
    if (typeof supplied[name] !== "string") {
      throw new TypeError(
        `resolveContextAsk: ${ask.concept}.${ask.action} needs blank ${JSON.stringify(name)} as a string.`,
      );
    }
  }
  const input = Object.freeze(
    Object.fromEntries(
      Object.entries(ask.input).map(([name, source]) => [
        name,
        source.source === "blank" ? supplied[source.name] : source.value,
      ]),
    ),
  );
  return Object.freeze({ ask, input });
}
