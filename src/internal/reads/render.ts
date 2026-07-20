/**
 * Render registered application IR as design notation.
 *
 * `renderReaction` prints `when`, `where`, and `then` blocks. `renderApp` adds
 * concept inventories, views, formers, reactions, and any reactions that the
 * IR cannot represent. Missing Purpose or Principle prose is labeled
 * `unwritten`. Opaque computations and unlowered reactions remain explicit.
 *
 * Some rendered forms describe engine-only behavior: `asked by` records
 * request provenance, `earlier` reads an earlier occurrence in the same flow,
 * channel triggers watch all actions in one posture, and a multi-clause
 * `when` joins occurrences. The renderer emits only `request` consequences;
 * attestations and world effects are not implemented.
 */

import type {
  ActionTriggerIR,
  AppIR,
  ArrangedIR,
  ChannelTriggerIR,
  ConceptInventoryIR,
  ConsequenceIR,
  FormerIR,
  FormerNodeIR,
  FormerWhereOpIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  ValueIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";
import { asMarker, hasMarkerKey } from "./ir.ts";

// ── Values and role lists ──────────────────────────────────────────────────

/** Render one pattern value as it reads inside a role list. */
export function renderValue(value: ValueIR): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(renderValue).join(", ")}]`;
  const mapping = value as Record<string, ValueIR>;
  const marker = asMarker(mapping);
  if (marker) {
    switch (marker.tag) {
      case "$var":
        return String(marker.payload);
      case "$oneOf":
        return `one of ${(marker.payload as ValueIR[]).map(renderValue).join(" or ")}`;
      case "$regexp": {
        const { source, flags } = marker.payload as { source: string; flags: string };
        return `/${source}/${flags}`;
      }
      case "$is":
        return `«opaque matcher: ${String(marker.payload)}»`;
      case "$former": {
        // A former reference reads as its sentence, slots filled — the value the
        // consequence carries is the former's tree, read at the moment of asking.
        const former = marker.payload as { name: string; in: PatternIR };
        return former.name.replace(/\(([^()]*)\)/g, (whole, slot: string) => {
          const filled = former.in[slot.trim()];
          return filled === undefined ? whole : `(${renderValue(filled)})`;
        });
      }
      case "$lit":
        return renderValue(marker.payload as ValueIR);
    }
  }
  return `(${renderRoles(mapping as PatternIR)})`;
}

function renderRole(key: string, value: ValueIR): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const mapping = value as Record<string, ValueIR>;
    if (hasMarkerKey(mapping, "$var") && mapping.$var === key) return key;
  }
  return `${key}: ${renderValue(value)}`;
}

/** Render a role list: bare names bind, colons rename, and literals test. */
export function renderRoles(pattern: PatternIR): string {
  return Object.entries(pattern)
    .map(([key, value]) => renderRole(key, value))
    .join(", ");
}

/**
 * A returned occurrence carries the action's inputs and outputs together,
 * so a trigger's role list merges both — identical roles listed once, and a
 * role both sides claim with different patterns qualified as `result.key`.
 */
function mergedTriggerRoles(trigger: ActionTriggerIR): string {
  const parts: string[] = [];
  const seen = new Map<string, string>();
  for (const [key, value] of Object.entries(trigger.input)) {
    const rendered = renderRole(key, value);
    parts.push(rendered);
    seen.set(key, rendered);
  }
  for (const [key, value] of Object.entries(trigger.output)) {
    const rendered = renderRole(key, value);
    if (seen.get(key) === rendered) continue;
    parts.push(seen.has(key) ? `result.${renderRole(key, value)}` : rendered);
  }
  return parts.join(", ");
}

// ── Triggers ───────────────────────────────────────────────────────────────

function renderActionOccurrence(trigger: ActionTriggerIR): string {
  // Returned is the default posture, so an explicit returned pin uses the
  // same text as an unmarked action trigger.
  const posture =
    trigger.posture === undefined || trigger.posture === "returned" ? "" : `${trigger.posture} `;
  const askedBy = trigger.by === undefined ? "" : `, asked by ${trigger.by}`;
  return `${posture}${trigger.concept}.${trigger.action} (${mergedTriggerRoles(trigger)})${askedBy}`;
}

function renderChannelTrigger(trigger: ChannelTriggerIR): string {
  const roles = renderRoles(trigger.pattern);
  const except = trigger.except.length === 0 ? "" : `, except ${trigger.except.join(" and ")}`;
  const exceptBy =
    trigger.exceptBy === undefined || trigger.exceptBy.length === 0
      ? ""
      : `, not asked by ${trigger.exceptBy.join(" or ")}`;
  return `any action is ${trigger.channel}${roles === "" ? "" : ` (${roles})`}${except}${exceptBy}`;
}

function renderTrigger(trigger: TriggerIR): string {
  return trigger.kind === "channel"
    ? renderChannelTrigger(trigger)
    : renderActionOccurrence(trigger);
}

// ── Where ops: one condition sentence per op kind ──────────────────────────

/** Render built-in relations as condition sentences. */
const HOLDS_SENTENCES: Record<string, (input: PatternIR) => string> = {
  lt: ({ left, right }) => `${renderValue(left)} is less than ${renderValue(right)}`,
  le: ({ left, right }) => `${renderValue(left)} is at most ${renderValue(right)}`,
  gt: ({ left, right }) => `${renderValue(left)} is greater than ${renderValue(right)}`,
  ge: ({ left, right }) => `${renderValue(left)} is at least ${renderValue(right)}`,
  among: ({ value, collection }) => `${renderValue(value)} is among ${renderValue(collection)}`,
};

/**
 * A sentence view named in a condition reads exactly as its sentence, slots
 * filled: `(workspace) has room` asked with `workspace` renders as
 * `workspace has room`. A relation view reads like a concept query.
 */
function renderViewSentence(name: string, input: PatternIR): string {
  if (!name.includes("(")) return `${name} (${renderRoles(input)})`;
  return name.replace(/\(([^()]*)\)/g, (whole, slot: string) => {
    const value = input[slot.trim()];
    return value === undefined ? whole : renderValue(value);
  });
}

/** Render one plain, `no`, or `whether` read with its input and output patterns. */
function renderLine(
  op: Extract<WhereOpIR, { op: "find" | "whether" | "no" }>,
  prefix: string,
): string {
  const call =
    "view" in op && op.view !== undefined
      ? renderViewSentence(op.view, op.in)
      : `${op.query?.concept}.${op.query?.query} (${renderRoles(op.in)})`;
  const out = renderRoles(op.out);
  const not = "not" in op && op.not !== undefined ? renderRoles(op.not) : "";
  return `${prefix}${call}${out === "" ? "" : ` has (${out})`}${not === "" ? "" : ` and not (${not})`}`;
}

/** Render one where op — from a reaction or a view block — as its condition sentence. */
export function renderWhereOp(op: WhereOpIR | ViewOpIR): string {
  switch (op.op) {
    case "find":
      return renderLine(op, "");
    case "no":
      return renderLine(op, "no ");
    case "whether":
      return renderLine(op, "whether ");
    case "earlier":
      return `earlier, ${renderActionOccurrence(op.when)}`;
    case "count":
      return `${op.out} is the count of ${op.query.concept}.${op.query.query} (${renderRoles(op.in)})`;
    case "holds": {
      const sentence = HOLDS_SENTENCES[op.computation];
      if (sentence !== undefined) return sentence(op.in);
      return `${op.computation} (${renderRoles(op.in)})`;
    }
    case "compute": {
      const input = renderRoles(op.in);
      const applied = input === "" ? op.computation : `${op.computation} (${input})`;
      return `${op.out} is ${applied}`;
    }
    case "custom": {
      const reads = op.in.length === 0 ? "" : ` reads (${op.in.join(", ")})`;
      const binds = op.out.length === 0 ? "" : ` binds (${op.out.join(", ")})`;
      return `custom computation "${op.fnRef}"${reads}${binds} — opaque code, not data`;
    }
  }
}

// ── Views ──────────────────────────────────────────────────────────────────

/**
 * Render one view in a ` ```view `
 * block): the sentence with its bare slots, then each where block — one line
 * when the block is a single condition, an indented conjunction otherwise.
 * Stacked blocks are the alternatives; this is where disjunction lives.
 */
export function renderView(view: ViewIR): string {
  const promiseWords = { one: "exactly one", optional: "at most one", many: "any number of" };
  // A sentence-form name already carries its `(slot)` groups; a plain name
  // (IR registered without a sentence) states its ins beside it.
  const named =
    view.ins === undefined || view.name.includes("(")
      ? view.name
      : `${view.name} (${view.ins.join(", ")})`;
  const heading =
    view.ins !== undefined &&
    view.outs !== undefined &&
    view.outs.length > 0 &&
    view.promise !== undefined
      ? `${named} — answers ${promiseWords[view.promise]} (${view.outs.join(", ")})`
      : named;
  const lines: string[] = [heading];
  for (const block of view.alternatives) {
    if (block.length === 1) {
      lines.push(`  where ${renderWhereOp(block[0])}`);
      continue;
    }
    lines.push("  where");
    for (const op of block) lines.push(`    ${renderWhereOp(op)}`);
  }
  return lines.join("\n");
}

// ── Formers ────────────────────────────────────────────────────────────────

function renderArranged(ordering: ArrangedIR): string {
  if ("by" in ordering) {
    return ordering.order === "ascending"
      ? `arranged by ${ordering.by}`
      : `arranged by ${ordering.by}, descending`;
  }
  return `arranged ${ordering.order}`;
}

function selectionTail(
  where: FormerWhereOpIR[] | undefined,
  arranged: ArrangedIR | undefined,
  pad: string,
): string[] {
  const lines: string[] = [];
  for (const op of where ?? []) lines.push(`${pad}where ${renderWhereOp(op)}`);
  if (arranged !== undefined) lines.push(`${pad}${renderArranged(arranged)}`);
  return lines;
}

/** Render one former node as lines at the given indent. */
function renderFormerNode(node: FormerNodeIR, indent: number): string[] {
  const pad = "  ".repeat(indent);
  switch (node.node) {
    case "leaf":
      return [`${pad}${node.var}`];
    case "record": {
      const lines = [`${pad}a record of`];
      for (const op of node.where ?? []) lines.push(`${pad}  where ${renderWhereOp(op)}`);
      for (const [key, child] of Object.entries(node.entries)) {
        if (child.node === "leaf") {
          lines.push(key === child.var ? `${pad}  ${key}` : `${pad}  ${key}: ${child.var}`);
          continue;
        }
        const rendered = renderFormerNode(child, indent + 1);
        lines.push(`${pad}  ${key}: ${rendered[0].trimStart()}`, ...rendered.slice(1));
      }
      for (const spliceIR of node.splices ?? []) {
        const posture = spliceIR.whether ? ", with blank leaves if absent" : "";
        const filled = spliceIR.fragment.replace(/\(([^()]*)\)/g, (whole, slot: string) => {
          const value = spliceIR.in[slot.trim()];
          return value === undefined ? whole : `(${renderRole(slot.trim(), value)})`;
        });
        lines.push(`${pad}  … ${filled}${posture}`);
      }
      return lines;
    }
    case "former": {
      const filled = node.former.replace(/\(([^()]*)\)/g, (whole, slot: string) => {
        const value = node.in[slot.trim()];
        return value === undefined ? whole : `(${renderRole(slot.trim(), value)})`;
      });
      return [`${pad}${node.whether ? "whether " : ""}${filled}`];
    }
    case "each": {
      const lines = [`${pad}each ${renderWhereOp(node.from)}`];
      lines.push(...selectionTail(node.where, node.arranged, `${pad}  `));
      const as = renderFormerNode(node.as, indent + 1);
      lines.push(`${pad}  form ${as[0].trimStart()}`, ...as.slice(1));
      return lines;
    }
    case "count": {
      return [
        `${pad}the count of ${renderWhereOp(node.from)}`,
        ...selectionTail(node.where, undefined, `${pad}  `),
      ];
    }
    case "first": {
      return [
        `${pad}the ${node.value} of the first ${renderWhereOp(node.from)}`,
        ...selectionTail(node.where, node.arranged, `${pad}  `),
      ];
    }
    case "distinct": {
      return [
        `${pad}the distinct ${node.value} of each ${renderWhereOp(node.from)}`,
        ...selectionTail(node.where, undefined, `${pad}  `),
      ];
    }
  }
}

/**
 * Render one former in a
 * ` ```former ` block): a complete heading followed by the tree of records,
 * comprehensions, named former reads, and aggregate leaves.
 */
export function renderFormer(formerIR: FormerIR): string {
  const heading =
    formerIR.promise === "optional"
      ? `If available, form ${formerIR.name} as follows:`
      : `Form ${formerIR.name} as follows:`;
  return [heading, ...renderFormerNode(formerIR.body, 1)].join("\n");
}

// ── Reactions ──────────────────────────────────────────────────────────────────

function renderConsequence(consequence: ConsequenceIR): string {
  return `request ${consequence.concept}.${consequence.action} (${renderRoles(consequence.input)})`;
}

/**
 * Render one reaction IR entry in a ` ```reaction ` block. A multi-clause `when` consumes
 * a joint match and prints each additional clause as `and jointly when …`.
 */
export function renderReaction(reaction: ReactionIR): string {
  const lines: string[] = [];
  reaction.when.forEach((trigger, index) => {
    lines.push(
      index === 0 ? `when ${renderTrigger(trigger)}` : `and jointly when ${renderTrigger(trigger)}`,
    );
  });
  if (reaction.where.length > 0) {
    lines.push("where");
    for (const op of reaction.where) lines.push(`  ${renderWhereOp(op)}`);
  }
  lines.push("then");
  for (const consequence of reaction.then) lines.push(`  ${renderConsequence(consequence)}`);
  return lines.join("\n");
}

// ── The application spec ───────────────────────────────────────────────────

/** Everything `renderApp` needs, as data. */
export interface AppSpecIR {
  /** The application's name, used as the document title. */
  title: string;
  /** Inventories of the instrumented concepts, in registration order. */
  concepts: ConceptInventoryIR[];
  /** The exported reaction IR and the reactions that stayed pipelines. */
  app: AppIR;
}

const UNWRITTEN = "_[unwritten in the registered concept specification]_";

function renderSignature(name: string, roles: readonly string[] | undefined): string {
  return roles === undefined ? `${name} (…)` : `${name} (${roles.join(", ")})`;
}

function renderConcept(concept: ConceptInventoryIR): string {
  const lines: string[] = [`### ${concept.name}`, ""];
  lines.push(`**Purpose.** ${concept.purpose ?? UNWRITTEN}`, "");
  lines.push(`**Principle.** ${concept.principle ?? UNWRITTEN}`, "");
  if (concept.actions.length > 0) {
    lines.push("Actions:", "");
    for (const action of concept.actions) {
      const refusals =
        action.refusals === undefined || action.refusals.length === 0
          ? ""
          : ` — may refuse ${action.refusals.map((code) => `\`${code}\``).join(", ")}`;
      lines.push(`- \`${renderSignature(action.name, action.roles)}\`${refusals}`);
    }
    lines.push("");
  }
  if (concept.queries.length > 0) {
    lines.push("Queries (standing questions the state answers):", "");
    for (const query of concept.queries) {
      const returns =
        query.returns === undefined
          ? ""
          : ` — promises ${
              query.returns === "one"
                ? "exactly one row"
                : query.returns === "optional"
                  ? "at most one row"
                  : "any number of rows"
            }`;
      lines.push(`- \`${renderSignature(query.name, query.roles)}\`${returns}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render a whole application's assembled read-back as one markdown document:
 * concepts, views, formers, reactions, and any reactions the IR cannot carry.
 * Missing concept prose is labeled rather than omitted.
 */
export function renderApp(spec: AppSpecIR): string {
  const lines: string[] = [
    `# ${spec.title} — assembled read-back`,
    "",
    "_Assembled by sync-engine from registered concepts and composition. Edit the concept_",
    "_specifications and composition source, then regenerate this file._",
    "",
  ];

  if (spec.concepts.length > 0) {
    lines.push("## Concepts", "");
    for (const concept of spec.concepts) lines.push(renderConcept(concept));
  }

  if (spec.app.views.length > 0) {
    lines.push("## Views", "");
    lines.push("_Views name reusable conditions. Multiple `where` blocks are alternatives._", "");
    for (const view of spec.app.views) {
      lines.push("```view", renderView(view), "```", "");
    }
  }

  if (spec.app.formers.length > 0) {
    lines.push("## Formers", "");
    lines.push(
      "_Formers name result shapes evaluated when asked. The source former owns_",
      "_the authored explanation; this section records the generated shape._",
      "",
    );
    for (const formerIR of spec.app.formers) {
      lines.push("```former", renderFormer(formerIR), "```", "");
    }
  }

  if (spec.app.reactions.length > 0) {
    lines.push("## Reactions", "");
    for (const reaction of spec.app.reactions) {
      lines.push(`### ${reaction.name}`, "", "```reaction", renderReaction(reaction), "```", "");
    }
  }

  if (spec.app.unlowered.length > 0) {
    lines.push("## Reactions represented only by executable code", "");
    lines.push(
      "*These reactions still execute. The renderer lists why their code could*",
      "*not be represented as registered reaction data.*",
      "",
    );
    for (const reaction of spec.app.unlowered) {
      lines.push(`- \`${reaction.name}\` — ${reaction.reason}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
