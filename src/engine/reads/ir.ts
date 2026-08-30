/**
 * Serializable intermediate representation for registered reactions, views,
 * and formers.
 *
 * The engine evaluates, exports, renders, and generates wire types from these
 * structures. `Reacting.exportReactions()` returns reaction IR as `ReactionIR`, and
 * `registerReactions()` binds imported concept, query, and computation names to
 * one engine. Opaque functions carry a marker but cannot be registered again
 * from JSON.
 *
 * `when` may contain several clauses. Such a trigger jointly consumes its
 * matching occurrences; `earlier` performs a separate non-consuming read of
 * preceding occurrences in the same flow.
 */

import type { ActionPosture, ChannelPosture } from "@engine/reactions/types";
import type { AuthoredDeclarationIdentity } from "./declaration-identity.ts";

/** A JSON-safe pattern value: literals, variables, matchers, nested shapes. */
export type ValueIR =
  | null
  | boolean
  | number
  | string
  | ValueIR[]
  | { $var: string }
  | { $oneOf: ValueIR[] }
  | { $regexp: { source: string; flags: string } }
  | { $is: string }
  | { $lit: Record<string, ValueIR> }
  | { $former: { name: string; in: PatternIR } }
  | { [key: string]: ValueIR };

/** A pattern: a mapping of role names to pattern values. */
export type PatternIR = Record<string, ValueIR>;

/** The `$`-tags a {@link ValueIR} carries beyond plain data and arrays. */
type MarkerTag = "$var" | "$oneOf" | "$regexp" | "$is" | "$former" | "$lit";

const MARKER_TAGS: readonly MarkerTag[] = ["$var", "$oneOf", "$regexp", "$is", "$former", "$lit"];

/** Whether `value` is a single-key mapping whose one key is `key` — a marker's spelling. */
export function hasMarkerKey(value: object, key: string): boolean {
  return key in value && Object.keys(value).length === 1;
}

/** Whether a pattern value is the `{ $var }` marker — a variable, by name. */
export function isVarIR(value: unknown): value is { $var: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    hasMarkerKey(value, "$var") &&
    typeof (value as { $var: unknown }).$var === "string"
  );
}

/**
 * The side channel for live values the IR cannot carry: a `custom` op's
 * function, an opaque matcher's predicate, a view or fragment reference
 * captured at its definition site. A symbol-keyed field stores the value, so
 * `JSON.stringify` never sees it — exports stay pure data. A node built by
 * the authoring surface carries it and runs; a node re-registered from JSON
 * lacks it, and whatever required it refuses at registration, exactly as
 * opaque escapes always have.
 */
const LIVE: unique symbol = Symbol("live");

/** Attach a definition-site live value to an IR node (returns the node). */
export function withLive<T extends object>(node: T, live: unknown): T {
  Object.defineProperty(node, LIVE, { value: live });
  return node;
}

/** Return the definition-site live value attached to an IR node, if present. */
export function liveOf(node: object): unknown {
  return (node as Record<symbol, unknown>)[LIVE];
}

/**
 * The one reading of the `$`-marker vocabulary: name which of the six markers
 * a pattern value is (its `tag`) and return that key's contents (its
 * `payload`); a plain mapping — anything not a lone `$`-key — answers `null`.
 * Decoders and renderers switch on the tag rather than re-probing the keys.
 */
export function asMarker(value: object): { tag: MarkerTag; payload: unknown } | null {
  for (const tag of MARKER_TAGS) {
    if (hasMarkerKey(value, tag)) return { tag, payload: (value as Record<string, unknown>)[tag] };
  }
  return null;
}

/** A trigger on one action's occurrences, optionally pinned to a posture. */
export interface ActionTriggerIR {
  kind: "action";
  concept: string;
  action: string;
  /** Absent: as authored (an empty output pattern admits successes only). */
  posture?: ActionPosture;
  /** Pin to occurrences asked for by one reaction — the ask's provenance. */
  by?: string;
  input: PatternIR;
  output: PatternIR;
}

/** A trigger on any action's occurrences, by posture (channel). */
export interface ChannelTriggerIR {
  kind: "channel";
  channel: ChannelPosture;
  pattern: PatternIR;
  /** Concept names whose occurrences the channel skips (the loop-guard). */
  except: string[];
  /** Reaction names whose own asks the channel skips (the provenance loop-guard). */
  exceptBy?: string[];
  /** Pin to occurrences asked for by one reaction — the ask's provenance. */
  by?: string;
}

export type TriggerIR = ActionTriggerIR | ChannelTriggerIR;

/**
 * The source a line reads: a concept query by name, or a view by
 * its registered name — indistinguishable at the use-site, so one field pair
 * carries both (exactly one is present).
 */
interface LineRefIR {
  query?: { concept: string; query: string };
  view?: string;
}

/**
 * A where op, serialized. `find` is the plain line (per-slot unification in `out`,
 * negated slot tests in `not`; an empty `out` is the bare call — existence);
 * `no` requires no matching row and cannot bind names; `whether` binds matched
 * values or assigns blanks. `holds` is a closed line over a named computation —
 * the built-in comparisons and vocabulary calculations read this way.
 */
export type WhereOpIR =
  | ({ op: "find" | "whether"; in: PatternIR; out: PatternIR; not?: PatternIR } & LineRefIR)
  | ({ op: "no"; in: PatternIR; out: PatternIR } & LineRefIR)
  | { op: "earlier"; when: ActionTriggerIR }
  | { op: "now"; out: string }
  | { op: "holds"; computation: string; in: PatternIR }
  | { op: "compute"; computation: string; in: PatternIR; out: string }
  | { op: "custom"; fnRef: string; opaque: true; in: string[]; out: string[] };

/**
 * An op inside a view's where block: the algebra minus `earlier` (a view
 * answers from standing state, not the flow's record), plus `count` — the
 * one aggregate, legal only here.
 */
export type ViewOpIR =
  | Exclude<WhereOpIR, { op: "earlier" | "now" }>
  | { op: "count"; query: { concept: string; query: string }; in: PatternIR; out: string };

/**
 * One view: its where blocks — each a conjunction, stacked blocks
 * alternatives. A relation view declares the same three facts a concept query
 * declares: `ins` (handed to it), `outs` (handed back, bound at
 * use-sites only through `.is`), and a promise — required whenever `outs` is
 * non-empty, absent for a pure predicate view. Free bindings stay local to the
 * definition. Binding names appear in the blocks as `{ $var }` references.
 */
export interface ViewIR {
  name: string;
  /** Selected-composition identity; absent for low-level or imported registrations. */
  authored?: AuthoredDeclarationIdentity;
  alternatives: ViewOpIR[][];
  ins: string[];
  outs: string[];
  bindings: string[];
  promise?: "one" | "optional" | "many";
  holds?: true;
}

/** How a former's comprehension orders what it kept. */
export type ArrangedIR =
  | { order: "oldest" | "newest" }
  | { by: string; order: "ascending" | "descending" };

/** A query reference, by names. */
export interface QueryRefIR {
  concept: string;
  query: string;
}

/** An op inside a former's selection: the where algebra minus `earlier` and `count`. */
export type FormerWhereOpIR = Exclude<WhereOpIR, { op: "earlier" | "now" }>;

/** A former selection begins from one plain line, query or view backed. */
export type FormerSourceIR = {
  op: "find";
  in: PatternIR;
  out: PatternIR;
  not?: PatternIR;
} & LineRefIR;

/**
 * One node of a former's tree: a leaf, a record of named smaller formers, a
 * comprehension, or a reduction over the same selection.
 */
/** A named former contributing its keys flat to a record. */
export interface SpliceIR {
  /** The fragment's sentence — resolves against the registered formers, dependencies first. */
  fragment: string;
  in: PatternIR;
  whether?: true;
}

export type FormerNodeIR =
  | { node: "leaf"; var: string }
  | {
      node: "record";
      where?: FormerWhereOpIR[];
      entries: Record<string, FormerNodeIR>;
      splices?: SpliceIR[];
    }
  | {
      node: "former";
      former: string;
      in: PatternIR;
      whether?: true;
    }
  | {
      node: "each";
      from: FormerSourceIR;
      where?: FormerWhereOpIR[];
      arranged?: ArrangedIR;
      as: FormerNodeIR;
    }
  | {
      node: "count";
      from: FormerSourceIR;
      where?: FormerWhereOpIR[];
    }
  | {
      node: "first";
      from: FormerSourceIR;
      where?: FormerWhereOpIR[];
      arranged?: ArrangedIR;
      value: string;
    }
  | {
      node: "distinct";
      from: FormerSourceIR;
      where?: FormerWhereOpIR[];
      value: string;
    };

/** One former: explicit input and free bindings, its promise, and its formed tree. */
export interface FormerIR {
  name: string;
  /** Selected-composition identity; absent for low-level or imported registrations. */
  authored?: AuthoredDeclarationIdentity;
  ins: string[];
  bindings: string[];
  promise: "one" | "optional";
  body: FormerNodeIR;
}

/** A consequence: the ask a firing makes. */
export interface ConsequenceIR {
  kind: "request";
  concept: string;
  action: string;
  input: PatternIR;
}

/** One reaction's when / where / then frame, as data. */
export interface ReactionIR {
  name: string;
  /** The top-level authored tree this lowered runtime reaction came from. */
  authored?: AuthoredDeclarationIdentity;
  when: TriggerIR[];
  /**
   * A deferred trigger: qualification waits for a settlement frontier in the
   * trigger's flow, and `where` is re-read at each frontier until the trigger
   * match qualifies or the flow finalizes. Absent: qualification happens where
   * the trigger lands.
   */
  deferred?: true;
  where: WhereOpIR[];
  then: ConsequenceIR[];
  /** Plain reads an authored partition assumes will fill. */
}

/** A reaction that could not be lowered to `ReactionIR` — visible, never silent. */
export interface UnloweredIR {
  name: string;
  /** The top-level authored tree this local runtime reaction came from. */
  authored?: AuthoredDeclarationIdentity;
  reason: string;
  /** Inspectable facts retained even though the complete definition is local code. */
  known: {
    when: TriggerIR[];
    /** Whether the local pipeline's first consequence waits for a settlement frontier. */
    deferred?: true;
    where: WhereOpIR[];
    then: ConsequenceIR[];
    patterns: PatternIR[];
  };
}

/** One installed pure computation, without its runtime function. */
export interface ComputationInventoryIR {
  name: string;
  source: "standard" | "vocabulary";
  /** Input roles observed from the function's destructuring; absent when unreadable. */
  inputs?: string[];
}

/** The canonical and assembly-selected implementation of one concept name. */
export interface ConceptImplementationProvenanceIR {
  concept: string;
  canonical: {
    owner: "core" | "application";
    constructorName?: string;
  };
  selected:
    | { via: "core" }
    | { via: "default" }
    | { via: "initialize" }
    | { via: "instances"; constructorName?: string; floor?: string };
}

/**
 * Everything the engine knows about registered application definitions, as
 * data. Concept and computation names inside those definitions are references;
 * their complete inventories live outside `AppIR`.
 */
export interface AppIR {
  /** Reaction definitions. */
  reactions: ReactionIR[];
  /** Referenced view definitions, dependencies before dependents. */
  views: ViewIR[];
  /** Referenced or explicitly declared former definitions, in registration order. */
  formers: FormerIR[];
  /** Reaction definitions retained only as non-portable inspection data. */
  unlowered: UnloweredIR[];
}

/** A one-based position in an authored concept specification. */
export interface SpecificationLocationIR {
  line: number;
  column: number;
}

/** A specification type expression, independent of an implementation language. */
export type SpecificationTypeIR =
  | {
      kind: "named";
      name: string;
      arguments: readonly SpecificationTypeIR[];
      location: SpecificationLocationIR;
    }
  | {
      kind: "union";
      members: readonly SpecificationTypeIR[];
      location: SpecificationLocationIR;
    }
  | { kind: "null"; location: SpecificationLocationIR }
  | { kind: "undefined"; location: SpecificationLocationIR };

/** One named field in a specification input or inline result row. */
export interface SpecificationFieldIR {
  name: string;
  optional: boolean;
  type: SpecificationTypeIR;
  location: SpecificationLocationIR;
}

/** The parenthesized named fields returned by an action or query. */
export interface SpecificationResultIR {
  kind: "fields";
  fields: readonly SpecificationFieldIR[];
  location: SpecificationLocationIR;
}

/** One authored refusal branch and its normative decoded sentence. */
export interface SpecificationRefusalIR {
  code: string;
  message: string;
  location: SpecificationLocationIR;
}

/** One authored action declaration. */
export interface SpecificationActionIR {
  name: string;
  /** Compatibility projection used by registration and source checking. */
  inputs: readonly string[];
  parameters: readonly SpecificationFieldIR[];
  result: SpecificationResultIR;
  body: string;
  refusals: readonly SpecificationRefusalIR[];
  location: SpecificationLocationIR;
}

/** One authored query declaration. */
export interface SpecificationQueryIR {
  name: string;
  /** Compatibility projection used by registration and source checking. */
  inputs: readonly string[];
  parameters: readonly SpecificationFieldIR[];
  result: SpecificationResultIR;
  body: string;
  promise: "one" | "optional" | "many";
  location: SpecificationLocationIR;
}

/** One opaque type parameter supplied by each application use of the concept. */
export interface SpecificationExternalTypeIR {
  name: string;
  /** Optional reader-facing explanation, normalized from its indented lines. */
  explanation: string;
  location: SpecificationLocationIR;
}

/** One concept-local type declared in the Types fence beside its external parameters. */
export type SpecificationLocalTypeIR = {
  name: string;
  /** Optional reader-facing explanation, normalized from its indented lines. */
  explanation: string;
  location: SpecificationLocationIR;
} & ({ kind: "enumeration"; values: readonly string[] } | { kind: "opaque" });

/** Simple State Form source retained from the State fence. */
export interface SpecificationStateIR {
  /** Normalized fence contents, privately validated against the version-1 SSF grammar. */
  body: string;
  /** Origin of `body` after surrounding blank fence lines are removed. */
  location: SpecificationLocationIR;
}

/** The JSON-safe authored contract parsed from one concept specification. */
export interface ConceptSpecificationIR {
  format: "sync-engine.concept-specification";
  version: 1;
  /** Reusable definition identity from the document's H1, independent of instance names. */
  definitionName: string;
  purpose: string;
  principle: string;
  externalTypes: readonly SpecificationExternalTypeIR[];
  localTypes: readonly SpecificationLocalTypeIR[];
  state: SpecificationStateIR;
  actions: readonly SpecificationActionIR[];
  queries: readonly SpecificationQueryIR[];
}

/** One action as the inventory reports it: its name, observed input roles, declared refusals. */
interface ActionInventoryIR {
  name: string;
  /** Input roles observed from the implementation's destructuring; absent when unreadable. */
  roles?: string[];
  /** The refusal codes the action's declared outcome contract carries. */
  refusals?: string[];
}

/** One query (a `_`-prefixed method): a standing question the concept's state answers. */
interface QueryInventoryIR {
  name: string;
  roles?: string[];
  /** The concept's promised cardinality. */
  returns?: "one" | "optional" | "many";
}

/**
 * Registered actions, queries, purpose, principle, and refusal codes for one
 * concept. Uninterpreted State sections are not inventory data.
 */
export interface ConceptInventoryIR {
  name: string;
  purpose?: string;
  principle?: string;
  actions: ActionInventoryIR[];
  queries: QueryInventoryIR[];
  /** Parsed authored contract; absent when the vocabulary declaration supplied no specification. */
  specification?: ConceptSpecificationIR;
}
