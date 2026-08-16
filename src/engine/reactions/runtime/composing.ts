/**
 * The **composition boundary** — the door through which a running engine's
 * composition changes. Register, retire, and replace are instrumented
 * actions, so every change lands in the occurrence log with its full
 * definition as input, serializes through the concept's scheduler, and can
 * itself be reacted to.
 */

import type { ReactionIR } from "@engine/reads/ir";
import type { OutcomeContracts } from "../concepts/outcomes.ts";
import { Refuse } from "../concepts/refuse.ts";
import type { ExecutableReaction } from "../types.ts";

/** One bound family entry: the executable and the definition it came from. */
export interface BoundFamilyEntry {
  executable: ExecutableReaction;
  reaction: ReactionIR;
}

/** What the composition door operates through on the engine that owns the catalog. */
export interface CompositionSeam {
  ownerOf(name: string): string | undefined;
  namesOf(base: string): string[] | undefined;
  bind(reaction: ReactionIR): ExecutableReaction;
  install(base: string, family: readonly BoundFamilyEntry[]): void;
  remove(base: string): void;
}

/** The composition door as callers reach it: instrumented actions taking and returning data. */
export interface CompositionActions {
  register(input: { name: string; reactions: ReactionIR[] }): Promise<Record<string, unknown>>;
  retire(input: { name: string }): Promise<Record<string, unknown>>;
  replace(input: { name: string; reactions: ReactionIR[] }): Promise<Record<string, unknown>>;
}

export class Composing {
  static readonly purpose =
    "Let a running application change what it reacts to without stopping, so a causal choice becomes live behavior the moment it is made.";

  static readonly principle =
    "A reaction arrives as portable data and is registered under its name; occurrences landing from then on match it. Retiring the name stops future matching without revoking what already fired; replacing swaps the name's definition in one step. Each change is itself an occurrence, so the composition's history reads back like any other history.";

  /**
   * Every operation names its subject and is all-or-nothing: a refusal
   * leaves the composition unchanged.
   */
  static readonly outcomes: OutcomeContracts = {
    register: { refusals: ["ALREADY_REGISTERED", "NOT_A_FAMILY", "NOT_BINDABLE"] },
    retire: { refusals: ["NOT_REGISTERED"] },
    replace: { refusals: ["NOT_REGISTERED", "ALREADY_REGISTERED", "NOT_A_FAMILY", "NOT_BINDABLE"] },
  };

  readonly #seam: CompositionSeam;

  constructor(seam: CompositionSeam) {
    this.#seam = seam;
  }

  register(args: Record<string, unknown>): Record<string, unknown> {
    const { name, reactions } = familyArguments(args);
    if (this.#seam.namesOf(name) !== undefined) {
      throw new Refuse("ALREADY_REGISTERED", { detail: `"${name}" is already registered` });
    }
    for (const entry of reactions) {
      const owner = this.#seam.ownerOf(entry.name);
      if (owner !== undefined) {
        throw new Refuse("ALREADY_REGISTERED", {
          detail: `"${entry.name}" is already owned by "${owner}"`,
        });
      }
    }
    this.#seam.install(name, this.#bindFamily(reactions));
    return { name, names: reactions.map((entry) => entry.name) };
  }

  retire(args: Record<string, unknown>): Record<string, unknown> {
    const name = subjectName(args);
    const names = this.#seam.namesOf(name);
    if (names === undefined) throw notRegistered(this.#seam, name, "retire");
    this.#seam.remove(name);
    return { name, names };
  }

  replace(args: Record<string, unknown>): Record<string, unknown> {
    const { name, reactions } = familyArguments(args);
    const retired = this.#seam.namesOf(name);
    if (retired === undefined) throw notRegistered(this.#seam, name, "replace");
    for (const entry of reactions) {
      const owner = this.#seam.ownerOf(entry.name);
      if (owner !== undefined && owner !== name) {
        throw new Refuse("ALREADY_REGISTERED", {
          detail: `"${entry.name}" is already owned by "${owner}"`,
        });
      }
    }
    const family = this.#bindFamily(reactions);
    this.#seam.remove(name);
    this.#seam.install(name, family);
    return { name, names: reactions.map((entry) => entry.name), retired };
  }

  #bindFamily(reactions: readonly ReactionIR[]): BoundFamilyEntry[] {
    return reactions.map((entry) => {
      try {
        return { executable: this.#seam.bind(entry), reaction: entry };
      } catch (error) {
        throw new Refuse("NOT_BINDABLE", {
          detail: `"${entry.name}": ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
  }
}

function subjectName(args: Record<string, unknown>): string {
  const name = args.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Refuse("NOT_REGISTERED", { detail: "the operation names no reaction" });
  }
  return name;
}

function familyArguments(args: Record<string, unknown>): {
  name: string;
  reactions: ReactionIR[];
} {
  const { name, reactions } = args;
  if (typeof name !== "string" || name.length === 0) {
    throw new Refuse("NOT_A_FAMILY", { detail: "a family is registered under a non-empty name" });
  }
  if (!Array.isArray(reactions) || reactions.length === 0) {
    throw new Refuse("NOT_A_FAMILY", {
      detail: "reactions must be a non-empty array of reaction definitions",
    });
  }
  const seen = new Set<string>();
  for (const entry of reactions) {
    const entryName = (entry as { name?: unknown } | null)?.name;
    if (typeof entry !== "object" || entry === null || typeof entryName !== "string") {
      throw new Refuse("NOT_A_FAMILY", {
        detail: "every entry must be a named reaction definition",
      });
    }
    if (seen.has(entryName)) {
      throw new Refuse("NOT_A_FAMILY", { detail: `"${entryName}" appears twice in the family` });
    }
    seen.add(entryName);
  }
  return { name, reactions: reactions as ReactionIR[] };
}

function notRegistered(seam: CompositionSeam, name: string, operation: string): Refuse {
  const owner = seam.ownerOf(name);
  return new Refuse("NOT_REGISTERED", {
    detail:
      owner === undefined
        ? `no reaction is registered under "${name}"`
        : `"${name}" is a stage of "${owner}" — ${operation} "${owner}"`,
  });
}
