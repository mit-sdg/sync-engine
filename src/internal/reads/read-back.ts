/**
 * Generate a registration read-back for views, formers, and reactions.
 * The output reports opened and tested names, cardinality behavior, declared
 * promises, inferred bounds, and coverage assumptions. `Reacting.readBack()`
 * returns the complete string, and registration also sends it to the logger.
 */

import type { QueryPromise } from "./query-contracts.ts";
import type {
  PatternIR,
  QueryRefIR,
  ReactionIR,
  FormerIR,
  TriggerIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";
import { varNamesInPattern } from "./former-analysis.ts";
import { scheduleBlock } from "./schedule.ts";
import { renderRoles, renderWhereOp } from "./render.ts";

/** What the read-back asks the registry: promises for queries and views. */
export interface ReadBackEnv {
  queryPromise(ref: QueryRefIR): QueryPromise | undefined;
  viewPromise(name: string): QueryPromise | undefined;
  viewProof(name: string): { declared?: QueryPromise; proven: QueryPromise } | undefined;
  formerProof(name: string): { declared: QueryPromise; proven: QueryPromise } | undefined;
}

const PROMISE_WORDS: Record<QueryPromise, string> = {
  one: "exactly one",
  optional: "at most one",
  many: "any number of",
};

/** The tested slots of a line: out entries that are literals or bound names. */
function testedSlots(
  op: Extract<WhereOpIR, { op: "find" | "whether" | "no" }>,
  opens: readonly string[],
): string[] {
  const tested: string[] = [];
  for (const [key, value] of Object.entries(op.out)) {
    const names = varNamesInPattern({ value } as PatternIR);
    if (names.length === 0 || names.some((name) => !opens.includes(name))) tested.push(key);
  }
  if ("not" in op && op.not !== undefined) {
    for (const key of Object.keys(op.not)) tested.push(`not ${key}`);
  }
  return tested;
}

/** Describe what one line opens, tests, and does with cardinality. */
function construeOp(op: WhereOpIR | ViewOpIR, opens: readonly string[], env: ReadBackEnv): string {
  const parts: string[] = [];
  const opensPart = opens.length > 0 ? `opens (${opens.join(", ")})` : "";
  switch (op.op) {
    case "find":
    case "whether":
    case "no": {
      const promise =
        "view" in op && op.view !== undefined
          ? (env.viewPromise(op.view) ?? undefined)
          : op.query !== undefined
            ? env.queryPromise(op.query)
            : undefined;
      const tested = testedSlots(op, opens);
      if (op.op === "no") {
        parts.push("holds only when no such row exists — drops the case otherwise");
        break;
      }
      if (op.op === "whether") {
        parts.push(
          opens.length > 0
            ? `binds or leaves blank (${opens.join(", ")} possibly blank)`
            : "proceeds either way",
        );
        if (promise === "many" && opens.length > 0) parts.push("fans out per match");
        break;
      }
      if (opens.length === 0) {
        parts.push("existence — fires once or drops the case");
        break;
      }
      if (promise === "one") parts.push("always fills");
      else if (promise === "optional") parts.push("fills or drops the case");
      else parts.push("fans out once per distinct fill");
      if (opensPart !== "") parts.push(opensPart);
      if (tested.length > 0) parts.push(`tests (${tested.join(", ")}) — may drop the case`);
      break;
    }
    case "holds":
      parts.push("tests — drops the case when it does not hold");
      break;
    case "compute":
      parts.push(`computes (${op.out})`);
      break;
    case "count":
      parts.push(`counts into (${op.out}) — always fills`);
      break;
    case "custom":
      parts.push("opaque code — the read-back cannot see inside");
      break;
    case "earlier":
      parts.push("reads the flow's record, once per matching occurrence");
      break;
  }
  return parts.join("; ");
}

function triggerOpens(trigger: TriggerIR): string[] {
  const names =
    trigger.kind === "channel"
      ? varNamesInPattern(trigger.pattern)
      : [...varNamesInPattern(trigger.input), ...varNamesInPattern(trigger.output)];
  return [...new Set(names)];
}

/** Generate one reaction's line-by-line read-back. */
export function readBackReaction(reaction: ReactionIR, env: ReadBackEnv): string {
  const lines: string[] = [`${reaction.name}`];
  const bound = new Set<string>();
  for (const trigger of reaction.when) {
    const opens = triggerOpens(trigger).filter((name) => !bound.has(name));
    for (const name of opens) bound.add(name);
    const head =
      trigger.kind === "channel"
        ? `any action ${trigger.channel}`
        : `${trigger.concept}.${trigger.action}`;
    lines.push(`  when ${head}${opens.length > 0 ? ` — opens (${opens.join(", ")})` : ""}`);
  }
  const scheduled = scheduleBlock(reaction.where, bound, `Reaction "${reaction.name}"`);
  for (const op of scheduled.ordered) {
    const opens = scheduled.opens.get(op) ?? [];
    lines.push(`  ${renderWhereOp(op)} — ${construeOp(op, opens, env)}`);
  }
  for (const consequence of reaction.then) {
    lines.push(
      `  then request ${consequence.concept}.${consequence.action} (${renderRoles(consequence.input)})`,
    );
  }
  for (const assumption of reaction.coverage ?? []) {
    lines.push(`  assumes ${assumption} fills`);
  }
  return lines.join("\n");
}

/** Generate one view's declared promise and inferred body bound. */
export function readBackView(view: ViewIR, env: ReadBackEnv): string {
  const lines: string[] = [];
  const proof = env.viewProof(view.name);
  const partitions = [
    view.ins.length > 0 ? `inputs (${view.ins.join(", ")})` : "inputs ()",
    view.outs.length > 0 ? `outputs (${view.outs.join(", ")})` : "outputs ()",
    view.bindings.length > 0 ? `bindings (${view.bindings.join(", ")})` : "bindings ()",
  ].join("; ");
  const head = `${view.name} — ${partitions}`;
  if (view.holds === true) {
    lines.push(`${head} — a predicate: holds or not`);
  } else {
    const promise = view.promise as QueryPromise;
    const declared = `promises ${PROMISE_WORDS[promise]} (${view.outs.join(", ")})`;
    const provenNote =
      proof === undefined || proof.proven === promise
        ? "the body proves it"
        : `the body proves ${PROMISE_WORDS[proof.proven]} — the declaration is enforced at run`;
    lines.push(`${head} — ${declared}; ${provenNote}`);
  }
  const ins = view.ins;
  for (const block of view.alternatives) {
    const initial = new Set(ins);
    const scheduled = scheduleBlock(block, initial, `View "${view.name}"`);
    for (const op of scheduled.ordered) {
      const opens = scheduled.opens.get(op) ?? [];
      lines.push(`  ${renderWhereOp(op)} — ${construeOp(op, opens, env)}`);
    }
  }
  return lines.join("\n");
}

export function readBackFormer(former: FormerIR, env: ReadBackEnv): string {
  const proof = env.formerProof(former.name);
  const proven = proof?.proven ?? former.promise;
  const note =
    proven === former.promise
      ? "the body proves it"
      : `the body proves ${PROMISE_WORDS[proven]} — the declaration is enforced at run`;
  const partitions = [
    former.ins.length > 0 ? `inputs (${former.ins.join(", ")})` : "inputs ()",
    former.bindings.length > 0 ? `bindings (${former.bindings.join(", ")})` : "bindings ()",
  ].join("; ");
  return `${former.name} — ${partitions}; promises ${PROMISE_WORDS[former.promise]}; ${note}`;
}

/** The whole application's read-back: every view, then every reaction. */
export function readBackApp(
  views: readonly ViewIR[],
  formers: readonly FormerIR[],
  reactions: readonly ReactionIR[],
  env: ReadBackEnv,
): string {
  const sections: string[] = [];
  for (const view of views) sections.push(readBackView(view, env));
  for (const former of formers) sections.push(readBackFormer(former, env));
  for (const reaction of reactions) sections.push(readBackReaction(reaction, env));
  return sections.join("\n\n");
}
