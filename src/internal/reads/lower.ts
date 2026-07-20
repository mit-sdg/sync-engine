/**
 * Lower fluent reaction declarations into one-consequence `ReactionIR` entries.
 *
 * A multi-step `then` becomes a chain named `Name`, `Name#2`, and so on.
 * Later reactions watch the preceding result and use `earlier` to recover values
 * from the same flow. A binding can cross steps only through an occurrence or
 * through a pure computation over values carried by occurrences.
 *
 * Reactions that depend on closure state, custom calculations, or unmatched
 * state-read rows remain executable pipelines and appear in
 * `exportReactions().unlowered` with a reason.
 */

import { conceptNameOf, actionNameOf } from "../reactions/introspect.ts";
import { isQueryRef } from "../reactions/refs.ts";
import { isMatcher, isPlainMapping } from "./matchers.ts";
import { liveOf, withLive } from "./ir.ts";
import { foldFormerNode } from "./schema.ts";
import { walkValueTree } from "./value-tree.ts";
import type {
  ActionPattern,
  ChannelPattern,
  Mapping,
  StepNode,
  ReactionDeclaration,
  ThenNode,
  TriggerPattern,
  WhereFn,
} from "../reactions/types.ts";
import type { AnyWhereOp, WhereOp } from "./where-ops.ts";
import type { ViewOp } from "./views.ts";
import type { RelationView } from "./lines.ts";
import type { Arranged, FormerNode, FormerRef, FusedFormer } from "./former-nodes.ts";
import { isFusedFormer } from "./former-nodes.ts";
import type { InstrumentedQuery } from "../reactions/types.ts";
import type { QueryRefIR } from "./ir.ts";
import type {
  ActionTriggerIR,
  AppIR,
  ArrangedIR,
  ConsequenceIR,
  FormerIR,
  FormerNodeIR,
  FormerSourceIR,
  FormerWhereOpIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  ValueIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";

// ── The lowered form ───────────────────────────────────────────────────────

export type LoweredWhereOp = AnyWhereOp;

/** One lowered reaction with live references, ready to compile. */
export interface LoweredReaction {
  name: string;
  /** Trigger clauses. More than one = a joint (consuming) trigger — see ir.ts. */
  when: TriggerPattern[];
  /** Declarative conditions (where ops, plus `earlier` reads). */
  whereOps?: LoweredWhereOp[];
  /** A closure-based `where`; opaque to IR and retained for execution. */
  whereFn?: WhereFn;
  /** The one consequence this reaction asks for. */
  step: StepNode;
  coverage?: string[];
}

export interface LowerOutcome {
  reactions?: LoweredReaction[];
  reason?: string;
}

// ── Pattern analysis ───────────────────────────────────────────────────────

function collectVars(value: unknown, into: Set<symbol>): void {
  walkValueTree(value, (node) => {
    if (typeof node === "symbol") into.add(node);
  });
}

function varsOf(...mappings: Array<Mapping | undefined>): Set<symbol> {
  const vars = new Set<symbol>();
  for (const mapping of mappings) {
    if (mapping !== undefined) collectVars(mapping, vars);
  }
  return vars;
}

function opOutVars(op: AnyWhereOp): symbol[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [...varsOf(op.out)];
    case "no":
      return [];
    case "compute":
      return [op.out];
    case "custom":
      return [...op.out];
    case "holds":
      return [];
    case "earlier":
      return [...varsOf(op.pattern.input, op.pattern.output)];
  }
}

function opInVars(op: AnyWhereOp): symbol[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [...varsOf(op.in, "not" in op ? op.not : undefined)];
    case "no":
      return [...varsOf(op.in, op.out)];
    case "compute":
      return [...varsOf(op.in)];
    case "holds":
      return [...varsOf(op.fused.in)];
    case "custom":
      return [...op.in];
    case "earlier":
      return [];
  }
}

function intersects(a: Set<symbol>, b: Iterable<symbol>): boolean {
  for (const item of b) if (a.has(item)) return true;
  return false;
}

// ── Then-tree analysis ─────────────────────────────────────────────────────

function isPlainStep(node: ThenNode): node is StepNode {
  return node.kind === "step" && node.transform === undefined;
}

// ── Lowering ───────────────────────────────────────────────────────────────

function returnedTrigger(step: StepNode, by: string): ActionPattern {
  return {
    ...step.action,
    output: step.action.output ?? {},
    posture: "returned",
    by,
  };
}

function triggerVars(pattern: TriggerPattern): Set<symbol> {
  if ("channel" in pattern) return varsOf(pattern.pattern);
  return varsOf(pattern.input, pattern.output);
}

/**
 * Build the reaction for step `i` of a chain (i ≥ 1): triggered on step i-1's
 * return, re-binding what step i needs from records earlier in the flow —
 * the reaction's own trigger clauses, prior steps — or from pure computations
 * over values already in hand.
 */
function lowerChainStep(
  decl: ReactionDeclaration,
  chain: StepNode[],
  i: number,
  names: string[],
): { reaction?: LoweredReaction; reason?: string } {
  const step = chain[i];
  const trigger = returnedTrigger(chain[i - 1], names[i - 1]);
  const available = varsOf(trigger.input, trigger.output);
  const needed = varsOf(step.action.input);
  const ops: LoweredWhereOp[] = [];

  const stillMissing = (): Set<symbol> =>
    new Set([...needed].filter((variable) => !available.has(variable)));

  // Records already in the flow, nearest context first: the reaction's trigger
  // clauses, then the chain's prior steps (each pinned to its own ask).
  const sources: Array<TriggerPattern | ActionPattern> = [
    ...decl.when,
    ...chain.slice(0, i - 1).map((prior, j) => returnedTrigger(prior, names[j])),
  ];
  for (const source of sources) {
    const sourceVars =
      "channel" in source ? triggerVars(source) : varsOf(source.input, source.output);
    if (!intersects(sourceVars, stillMissing())) continue;
    if ("channel" in source) {
      return { reason: `step ${i + 1} needs a binding from a channel trigger` };
    }
    ops.push({ op: "earlier", pattern: { ...source, output: source.output ?? {} } });
    for (const variable of sourceVars) available.add(variable);
  }

  // Values that never landed on a record can still be re-derived — but only
  // by a pure computation over values in hand. Anything else must stay a
  // pipeline rather than silently change meaning.
  if (stillMissing().size > 0) {
    if (decl.whereOps === undefined) {
      return { reason: `step ${i + 1} needs a value bound by a closure where` };
    }
    for (const op of decl.whereOps) {
      const outs = opOutVars(op);
      if (!intersects(stillMissing(), outs)) continue;
      if (op.op === "find" || op.op === "whether" || op.op === "earlier") {
        return {
          reason: `step ${i + 1} needs rows from a state read, which would re-run at a later position`,
        };
      }
      if (!opInVars(op).every((variable) => available.has(variable))) {
        return {
          reason: `step ${i + 1} needs a computation whose inputs do not travel on a record`,
        };
      }
      ops.push(op);
      for (const variable of outs) available.add(variable);
    }
    if (stillMissing().size > 0) {
      return { reason: `step ${i + 1} uses a variable no record or computation carries` };
    }
  }

  return {
    reaction: {
      name: names[i],
      when: [trigger],
      ...(ops.length > 0 ? { whereOps: ops } : {}),
      step,
      ...(decl.coverage !== undefined ? { coverage: [...decl.coverage] } : {}),
    },
  };
}

/** Lower one registered reaction into `ReactionIR`, or report why it remains a pipeline. */
export function lowerReaction(name: string, decl: ReactionDeclaration): LowerOutcome {
  // A `then` is a single chain of plain steps (a step transform stops lowering).
  if (!decl.then.every(isPlainStep)) return { reason: "a step transform in the pipeline" };
  const chain = decl.then as StepNode[];

  // The first step keeps the reaction's name; each later step becomes `Name#i`.
  const names = chain.map((step, i) => step.stepName ?? (i === 0 ? name : `${name}#${i + 1}`));

  const reactions: LoweredReaction[] = [
    {
      name: names[0],
      when: decl.when,
      ...(decl.whereOps !== undefined
        ? { whereOps: [...decl.whereOps] }
        : decl.where !== undefined
          ? { whereFn: decl.where }
          : {}),
      step: chain[0],
      ...(decl.coverage !== undefined ? { coverage: [...decl.coverage] } : {}),
    },
  ];

  for (let i = 1; i < chain.length; i++) {
    const lowered = lowerChainStep(decl, chain, i, names);
    if (lowered.reaction === undefined) return { reason: lowered.reason };
    reactions.push(lowered.reaction);
  }
  return { reactions };
}

// ── The unused-opened-name lint ────────────────────────────────────────────

const reactionLintExtraUses = new WeakMap<ReactionDeclaration, readonly symbol[]>();

export function setReactionLintExtraUses(
  declaration: ReactionDeclaration,
  uses: readonly symbol[],
): ReactionDeclaration {
  reactionLintExtraUses.set(declaration, uses);
  return declaration;
}

export function copyReactionLintExtraUses(
  source: ReactionDeclaration,
  target: ReactionDeclaration,
): void {
  const uses = reactionLintExtraUses.get(source);
  if (uses !== undefined) reactionLintExtraUses.set(target, uses);
}

function countSymbols(value: unknown, counts: Map<symbol, number>): void {
  walkValueTree(value, (node) => {
    if (typeof node === "symbol") counts.set(node, (counts.get(node) ?? 0) + 1);
  });
}

function countOpSymbols(op: AnyWhereOp, counts: Map<symbol, number>): void {
  switch (op.op) {
    case "find":
    case "whether":
      countSymbols(op.in, counts);
      countSymbols(op.out, counts);
      if ("not" in op) countSymbols(op.not, counts);
      return;
    case "no":
      countSymbols(op.in, counts);
      countSymbols(op.out, counts);
      return;
    case "holds":
      countSymbols(op.fused.in, counts);
      return;
    case "compute":
      countSymbols(op.in, counts);
      countSymbols([op.out], counts);
      return;
    case "custom":
      countSymbols([...op.in, ...op.out], counts);
      return;
    case "earlier":
      countSymbols(op.pattern.input, counts);
      countSymbols(op.pattern.output, counts);
      return;
  }
}

/**
 * A name a condition line opens and nothing reads — no other line, no step
 * input, no later chain step — is a registration error: omit the key
 * instead. Linted on the whole authored declaration, before lowering, so a
 * chain's later steps count as readers; imported IR re-registers unlinted.
 */
export function lintReactionOpens(name: string, decl: ReactionDeclaration): void {
  const ops = decl.whereOps ?? [];
  if (ops.length === 0) return;
  const counts = new Map<symbol, number>();
  for (const clause of decl.when) {
    if ("channel" in clause) countSymbols(clause.pattern, counts);
    else {
      countSymbols(clause.input, counts);
      countSymbols(clause.output, counts);
    }
  }
  for (const op of ops) countOpSymbols(op, counts);
  for (const node of decl.then) {
    countSymbols(node.action.input, counts);
    countSymbols(node.action.output, counts);
    for (const op of node.transformOps ?? []) countOpSymbols(op, counts);
  }
  for (const variable of reactionLintExtraUses.get(decl) ?? []) {
    counts.set(variable, (counts.get(variable) ?? 0) + 1);
  }
  for (const op of ops) {
    if (op.op !== "find" && op.op !== "whether") continue;
    for (const variable of varsOf(op.out)) {
      if ((counts.get(variable) ?? 0) <= 1) {
        throw new Error(
          `Reaction "${name}": "${String(variable.description ?? variable.toString())}" is opened and never used — omit the key instead.`,
        );
      }
    }
  }
}

// ── Then-input strictness ──────────────────────────────────────────────────

function describeValue(value: unknown): string {
  if (typeof value === "function") return "a function";
  if (value instanceof RegExp) return "a RegExp";
  if (isMatcher(value)) return `a matcher (${value.label})`;
  if (value instanceof Date) return "a Date";
  if (value !== null && typeof value === "object") {
    return `a ${value.constructor?.name ?? "non-plain"} instance`;
  }
  return typeof value;
}

function assertDataValue(reactionName: string, action: string, key: string, value: unknown): void {
  if (value === null || typeof value === "symbol") return;
  const kind = typeof value;
  if (kind === "boolean" || kind === "number" || kind === "string" || kind === "bigint") return;
  if (value === undefined) return;
  // A fused former is data — a named ref plus a slot pattern, evaluated per
  // firing at the moment of asking, never a registration-time value.
  if (isFusedFormer(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertDataValue(reactionName, action, key, item);
    return;
  }
  if (isPlainMapping(value)) {
    for (const [k, v] of Object.entries(value))
      assertDataValue(reactionName, action, `${key}.${k}`, v);
    return;
  }
  throw new Error(
    `Reaction "${reactionName}": then input "${key}" for ${action} is ${describeValue(value)} — a ` +
      `registration-time value that would be frozen into every future firing. Then inputs are ` +
      `literals or variables; compute a per-firing value with a vocabulary computation or custom op.`,
  );
}

function walkSteps(nodes: ThenNode[], visit: (step: StepNode) => void): void {
  for (const node of nodes) visit(node);
}

/**
 * Every consequence input must contain literals, bound variables, fused
 * formers, or registered per-firing computations. Values calculated while the
 * reaction is declared are rejected.
 */
export function assertThenInputsAreData(reactionName: string, then: ThenNode[]): void {
  walkSteps(then, (step) => {
    const action = `${conceptNameOf(step.action.concept)}.${actionNameOf(step.action.action)}`;
    for (const [key, value] of Object.entries(step.action.input)) {
      assertDataValue(reactionName, action, key, value);
    }
  });
}

// ── Serialization: lowered reactions → IR ─────────────────────────────────

class VarNames {
  private names = new Map<symbol, string>();
  private taken = new Set<string>();

  /** Pin a variable to an exact name — how a relation's slots keep their keys. */
  nameAs(variable: symbol, name: string): void {
    const existing = this.names.get(variable);
    if (existing === name) return;
    if (existing !== undefined || this.taken.has(name)) {
      throw new Error(`Variable name "${name}" is already taken.`);
    }
    this.names.set(variable, name);
    this.taken.add(name);
  }

  nameOf(variable: symbol): string {
    const existing = this.names.get(variable);
    if (existing !== undefined) return existing;
    const base =
      variable.description === undefined || variable.description === ""
        ? "v"
        : variable.description;
    let candidate = base;
    let counter = 1;
    while (this.taken.has(candidate)) {
      counter += 1;
      candidate = `${base}$${counter}`;
    }
    this.names.set(variable, candidate);
    this.taken.add(candidate);
    return candidate;
  }
}

function encodeValue(value: unknown, vars: VarNames): ValueIR {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "symbol") return { $var: vars.nameOf(value) };
  if (isFusedFormer(value)) {
    return { $former: { name: value.former.formerName, in: encodePattern(value.in, vars) } };
  }
  if (value instanceof RegExp) return { $regexp: { source: value.source, flags: value.flags } };
  if (isMatcher(value)) {
    if (value.kind === "oneOf") {
      return { $oneOf: (value.candidates ?? []).map((candidate) => encodeValue(candidate, vars)) };
    }
    return withLive({ $is: value.label }, value);
  }
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, vars));
  if (isPlainMapping(value)) {
    const encoded: Record<string, ValueIR> = {};
    for (const [key, item] of Object.entries(value)) encoded[key] = encodeValue(item, vars);
    if (Object.keys(encoded).some((key) => key.startsWith("$"))) return { $lit: encoded };
    return encoded;
  }
  // A non-plain literal (Date, Map, class instance) in a *when* pattern:
  // representable only as an opaque marker. Then inputs never get here —
  // registration rejects them.
  return withLive({ $is: `literal ${(value as object).constructor?.name ?? "value"}` }, value);
}

function encodePattern(mapping: Mapping | undefined, vars: VarNames): PatternIR {
  const encoded: PatternIR = {};
  for (const [key, value] of Object.entries(mapping ?? {})) encoded[key] = encodeValue(value, vars);
  return encoded;
}

function exceptNames(clause: ChannelPattern): string[] {
  const names = clause.except.map((entry) => {
    const candidate =
      typeof entry === "function" ? ((entry as { concept?: object }).concept ?? entry) : entry;
    return conceptNameOf(candidate as object);
  });
  return [...new Set(names)];
}

function encodeActionTrigger(pattern: ActionPattern, vars: VarNames): ActionTriggerIR {
  return {
    kind: "action",
    concept: conceptNameOf(pattern.concept),
    action: actionNameOf(pattern.action),
    ...(pattern.posture !== undefined ? { posture: pattern.posture } : {}),
    ...(pattern.by !== undefined ? { by: pattern.by } : {}),
    input: encodePattern(pattern.input, vars),
    output: encodePattern(pattern.output, vars),
  };
}

function encodeTrigger(pattern: TriggerPattern, vars: VarNames): TriggerIR {
  if ("channel" in pattern) {
    return {
      kind: "channel",
      channel: pattern.channel,
      pattern: encodePattern(pattern.pattern, vars),
      except: exceptNames(pattern),
      ...(pattern.exceptBy !== undefined && pattern.exceptBy.length > 0
        ? { exceptBy: [...pattern.exceptBy] }
        : {}),
      ...(pattern.by !== undefined ? { by: pattern.by } : {}),
    };
  }
  return encodeActionTrigger(pattern, vars);
}

/** The `{ concept, query }` names a query reference carries, live or static. */
function queryRefOf(query: InstrumentedQuery): QueryRefIR {
  if (isQueryRef(query)) return { concept: query.refConcept, query: query.refQuery };
  return { concept: conceptNameOf(query.concept ?? {}), query: query.queryName ?? "?" };
}

function encodeOp(op: LoweredWhereOp, vars: VarNames): WhereOpIR {
  switch (op.op) {
    case "earlier":
      return { op: "earlier", when: encodeActionTrigger(op.pattern, vars) };
    case "find":
    case "whether":
    case "no": {
      const not = "not" in op && op.not !== undefined ? op.not : undefined;
      const encoded = {
        op: op.op,
        ...(op.query !== undefined
          ? { query: queryRefOf(op.query) }
          : { view: op.view?.viewName ?? "?" }),
        in: encodePattern(op.in, vars),
        out: encodePattern(op.out, vars),
        ...(not !== undefined ? { not: encodePattern(not, vars) } : {}),
      };
      return op.view !== undefined ? withLive(encoded, op.view) : encoded;
    }
    case "holds":
      return withLive(
        {
          op: "holds" as const,
          computation: op.fused.computation.computationName,
          in: encodePattern(op.fused.in, vars),
        },
        op.fused.computation,
      );
    case "compute":
      return withLive(
        {
          op: "compute" as const,
          computation: op.computation.computationName,
          in: encodePattern(op.in, vars),
          out: vars.nameOf(op.out),
        },
        op.computation,
      );
    case "custom":
      return withLive(
        {
          op: "custom" as const,
          fnRef: op.name,
          opaque: true as const,
          in: op.in.map((variable) => vars.nameOf(variable)),
          out: op.out.map((variable) => vars.nameOf(variable)),
        },
        op.fn,
      );
  }
}

function encodeConsequence(step: StepNode, vars: VarNames): ConsequenceIR {
  return {
    kind: "request",
    concept: conceptNameOf(step.action.concept),
    action: actionNameOf(step.action.action),
    input: encodePattern(step.action.input, vars),
  };
}

/**
 * Serialize one lowered reaction to JSON-safe IR. A closure-based `where`
 * serializes as an opaque marker and is attached through its {@link LIVE}
 * side channel, so the authored reaction still executes while an imported copy
 * refuses — the opaque-escape contract, unchanged.
 */
export function serializeReaction(reaction: LoweredReaction): ReactionIR {
  const vars = new VarNames();
  const when = reaction.when.map((clause) => encodeTrigger(clause, vars));
  const where: WhereOpIR[] =
    reaction.whereFn !== undefined
      ? [{ op: "custom", fnRef: "<where closure>", opaque: true, in: [], out: [] }]
      : (reaction.whereOps ?? []).map((op) => encodeOp(op, vars));
  const ir: ReactionIR = {
    name: reaction.name,
    when,
    where,
    then: [encodeConsequence(reaction.step, vars)],
    ...(reaction.coverage !== undefined ? { coverage: [...reaction.coverage] } : {}),
  };
  if (reaction.whereFn !== undefined) withLive(ir, reaction.whereFn);
  return ir;
}

// ── Views: serialization and collection ────────────────────────────────────

function encodeViewOp(op: ViewOp, vars: VarNames): ViewOpIR {
  if (op.op === "count") {
    return {
      op: "count",
      query: queryRefOf(op.query),
      in: encodePattern(op.in, vars),
      out: vars.nameOf(op.out),
    };
  }
  return encodeOp(op, vars) as ViewOpIR;
}

/**
 * Lower one finished view's where blocks at its definition boundary. Slot
 * symbols are named first, so a slot's `{ $var }` references carry the
 * sentence's own slot names; emitted nodes retain definition-site references
 * ops as {@link LIVE} side channels.
 */
export function lowerViewAlternatives(
  slotVars: readonly symbol[],
  alternatives: readonly (readonly ViewOp[])[],
): ViewOpIR[][] {
  const vars = new VarNames();
  for (const slotVar of slotVars) vars.nameOf(slotVar);
  return alternatives.map((block) => block.map((op) => encodeViewOp(op, vars)));
}

/**
 * Lower a relation view's blocks: each in/out slot's variable is pinned to
 * its declared key first, so the seeded frame and the projected rows read
 * the same names the body's `{ $var }` references carry.
 */
export function lowerRelationBlocks(
  named: ReadonlyMap<symbol, string>,
  alternatives: readonly (readonly ViewOp[])[],
): ViewOpIR[][] {
  const vars = new VarNames();
  for (const [variable, name] of named) vars.nameAs(variable, name);
  return alternatives.map((block) => block.map((op) => encodeViewOp(op, vars)));
}

/** Serialize one view: the registered alternatives already are the IR. */
export function serializeView(ref: RelationView): ViewIR {
  return {
    name: ref.viewName,
    alternatives: ref.alternatives as ViewOpIR[][],
    ins: [...ref.ins],
    outs: [...ref.outs],
    ...(ref.promise !== undefined ? { promise: ref.promise } : {}),
  };
}

/** Whether a registered read operation names a view. */
export function viewLineIR(
  op: WhereOpIR | ViewOpIR,
): op is Extract<ViewOpIR, { op: "find" | "whether" | "no" }> & { view: string } {
  return (
    (op.op === "find" || op.op === "whether" || op.op === "no") &&
    "view" in op &&
    typeof op.view === "string"
  );
}

/** The views one view's blocks rest on, by name with definition-site refs. */
export function viewChannelsOfView(ref: {
  alternatives: readonly (readonly ViewOpIR[])[];
}): FormerChannel<RelationView>[] {
  const channels: FormerChannel<RelationView>[] = [];
  for (const block of ref.alternatives) {
    for (const op of block) {
      if (viewLineIR(op)) {
        channels.push({ name: op.view, live: liveOf(op) as RelationView | undefined });
      }
    }
  }
  return channels;
}

/** Add a view and, first, the views it rests on — dependencies before dependents. */
function addView(
  ref: RelationView,
  into: Map<string, RelationView>,
  viewOf: (name: string) => RelationView | undefined,
): void {
  if (into.has(ref.viewName)) return;
  for (const channel of viewChannelsOfView(
    ref as { alternatives: readonly (readonly ViewOpIR[])[] },
  )) {
    const inner = channel.live ?? viewOf(channel.name);
    if (inner !== undefined) addView(inner, into, viewOf);
  }
  into.set(ref.viewName, ref);
}

/** Every view a set of registered reactions references, transitively, in dependency order. */
export function collectViews(
  reactions: Iterable<ReactionIR[]>,
  formers: Iterable<FormerRef> = [],
  viewOf: (name: string) => RelationView | undefined = () => undefined,
): RelationView[] {
  const views = new Map<string, RelationView>();
  for (const group of reactions) {
    for (const reaction of group) {
      for (const op of reaction.where) {
        if (viewLineIR(op)) {
          const view = (liveOf(op) as RelationView | undefined) ?? viewOf(op.view);
          if (view !== undefined) addView(view, views, viewOf);
        }
      }
    }
  }
  for (const ref of formers) {
    for (const channel of viewChannelsOfFormer(ref)) {
      const view = channel.live ?? viewOf(channel.name);
      if (view !== undefined) addView(view, views, viewOf);
    }
  }
  return [...views.values()];
}

// ── Formers: definition-boundary lowering and collection ──────────────────

function encodeArranged(ordering: Arranged, vars: VarNames): ArrangedIR {
  if ("by" in ordering) return { by: vars.nameOf(ordering.by), order: ordering.order };
  return { order: ordering.order };
}

function encodeFormerWhere(
  where: readonly WhereOp[],
  vars: VarNames,
): { where?: FormerWhereOpIR[] } {
  if (where.length === 0) return {};
  return { where: where.map((op) => encodeOp(op, vars) as FormerWhereOpIR) };
}

function encodeFormerNode(node: FormerNode, vars: VarNames): FormerNodeIR {
  switch (node.node) {
    case "leaf":
      return { node: "leaf", var: vars.nameOf(node.var) };
    case "record": {
      const entries: Record<string, FormerNodeIR> = {};
      for (const [key, child] of node.entries) entries[key] = encodeFormerNode(child, vars);
      const splices = node.splices.map((use) =>
        withLive(
          {
            fragment: use.fused.former.formerName,
            in: encodePattern(use.fused.in, vars),
            ...(use.whether ? { whether: true as const } : {}),
          },
          use.fused.former,
        ),
      );
      return {
        node: "record",
        ...encodeFormerWhere(node.where, vars),
        entries,
        ...(splices.length > 0 ? { splices } : {}),
      };
    }
    case "former":
      return withLive(
        {
          node: "former" as const,
          former: node.use.fused.former.formerName,
          in: encodePattern(node.use.fused.in, vars),
          ...(node.use.whether ? { whether: true as const } : {}),
        },
        node.use.fused.former,
      );
    case "each":
      return {
        node: "each",
        from: encodeOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        ...(node.arranged !== undefined ? { arranged: encodeArranged(node.arranged, vars) } : {}),
        as: encodeFormerNode(node.as, vars),
      };
    case "count":
      return {
        node: "count",
        from: encodeOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
      };
    case "first":
      return {
        node: "first",
        from: encodeOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        ...(node.arranged !== undefined ? { arranged: encodeArranged(node.arranged, vars) } : {}),
        value: vars.nameOf(node.value),
      };
    case "distinct":
      return {
        node: "distinct",
        from: encodeOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        value: vars.nameOf(node.value),
      };
  }
}

/**
 * Lower one finished former body at its definition boundary. Slot symbols
 * are named first, so slot `{ $var }` references carry the sentence's own
 * slot names; definition-site references (view templates, fragment refs,
 * computations and opaque escapes) remain on emitted nodes as {@link LIVE}
 * side channels.
 */
export function lowerFormerBody(slotVars: readonly symbol[], body: FormerNode): FormerNodeIR {
  const vars = new VarNames();
  for (const slotVar of slotVars) vars.nameOf(slotVar);
  return encodeFormerNode(body, vars);
}

/** Serialize one former: the registered body already is the IR. */
export function serializeFormer(ref: FormerRef): FormerIR {
  return { name: ref.formerName, promise: ref.promise, body: ref.body };
}

/** One reference a former's body carries: its name, and the definition-site live value if any. */
export interface FormerChannel<T> {
  name: string;
  live?: T;
}

/** Every view a former's selections consult (through a view line), by name. */
export function viewChannelsOfFormer(ref: FormerRef): FormerChannel<RelationView>[] {
  const channels: FormerChannel<RelationView>[] = [];
  foldFormerNode(ref.body, {
    op: (op) => {
      if (viewLineIR(op)) {
        channels.push({ name: op.view, live: liveOf(op) as RelationView | undefined });
      }
    },
  });
  return channels;
}

/** Every fragment a former's records splice — the host's former dependencies. */
export function fragmentChannelsOfFormer(ref: FormerRef): FormerChannel<FormerRef>[] {
  const channels: FormerChannel<FormerRef>[] = [];
  foldFormerNode(ref.body, {
    node: (node) => {
      if (node.node !== "former") return;
      channels.push({ name: node.former, live: liveOf(node) as FormerRef | undefined });
    },
    splice: (use) => {
      channels.push({ name: use.fragment, live: liveOf(use) as FormerRef | undefined });
    },
  });
  return channels;
}

/** Every fused former referenced in a mapping's values, recursively. */
export function fusedFormersOf(mapping: Mapping): FusedFormer[] {
  const found: FusedFormer[] = [];
  walkValueTree(mapping, (value) => {
    if (!isFusedFormer(value)) return;
    found.push(value);
    return false;
  });
  return found;
}

/** Assemble the exported app IR from the engine's registration bookkeeping. */
export function serializeApp(
  registered: Iterable<ReactionIR[]>,
  unlowered: Iterable<[string, string]>,
  formers: Iterable<FormerRef> = [],
  viewOf: (name: string) => RelationView | undefined = () => undefined,
): AppIR {
  const groups = [...registered];
  const formerRefs = [...formers];
  return {
    reactions: groups.flat(),
    views: collectViews(groups, formerRefs, viewOf).map((ref) => serializeView(ref)),
    formers: formerRefs.map((ref) => serializeFormer(ref)),
    unlowered: [...unlowered].map(([name, reason]) => ({ name, reason })),
  };
}
