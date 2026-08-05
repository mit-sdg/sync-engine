/** Bind portable read and reaction IR to one engine's installed definitions. */

import type { NameResolver } from "@engine/reactions/resolving";
import type {
  ActionTriggerPattern,
  StepNode,
  TriggerPattern,
  WhereFn,
} from "@engine/reactions/types";
import { formerRefWith } from "./former-nodes.ts";
import type { FormerRef } from "./former-nodes.ts";
import { hasMarkerKey, liveOf } from "./ir.ts";
import type {
  ActionTriggerIR,
  FormerIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  ViewIR,
  WhereOpIR,
} from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { varNamesInPattern } from "./operation-footprint.ts";
import { scheduleBlock } from "./schedule.ts";
import { walkValueTree } from "./value-tree.ts";
import { relationViewWith, assertViewShape } from "./views.ts";
import { assertSeparateBags } from "./sentence.ts";
import { viewLineIR } from "./view-lowering.ts";
import type { EarlierOp } from "./where-ops.ts";

export type BoundWhereOp = Exclude<WhereOpIR, { op: "earlier" }> | EarlierOp;

export interface BoundReaction {
  name: string;
  when: TriggerPattern[];
  whereOps?: BoundWhereOp[];
  whereFn?: WhereFn;
  step: StepNode;
}

export class ImportedIrBinder {
  constructor(
    private readonly definitions: {
      resolver: NameResolver;
      formerNamed(name: string): FormerRef | undefined;
      assertPatternUsable(
        pattern: unknown,
        site: string,
        kind: "Former" | "View" | "Reaction",
      ): void;
      assertOpUsable(
        op: import("./ir.ts").ViewOpIR,
        site: string,
        kind: "Former" | "View" | "Reaction",
      ): void;
    },
  ) {}

  bindReaction(reaction: ReactionIR): BoundReaction {
    if (reaction.then.length !== 1) {
      throw new Error(`Reaction "${reaction.name}": expected exactly one consequence.`);
    }
    const consequence = reaction.then[0];
    const initial = new Set<string>();
    for (const clause of reaction.when) {
      const patterns = clause.kind === "channel" ? [clause.pattern] : [clause.input, clause.output];
      for (const pattern of patterns) {
        for (const name of varNamesInPattern(pattern)) initial.add(name);
      }
    }
    const scheduled = scheduleBlock(reaction.where, initial, `Reaction "${reaction.name}"`);
    reaction.where.splice(0, reaction.where.length, ...scheduled.ordered);
    for (const name of varNamesInPattern(consequence.input)) {
      if (!scheduled.bound.has(name)) {
        throw new Error(
          `Reaction "${reaction.name}": consequence input uses "${name}" before it is bound.`,
        );
      }
    }
    this.assertConsequenceUsable(consequence.input, reaction.name);
    const bound: BoundReaction = {
      name: reaction.name,
      when: reaction.when.map((clause) => this.bindTrigger(clause, reaction.name)),
      step: {
        kind: "step",
        action: this.definitions.resolver.action(
          consequence.concept,
          consequence.action,
          consequence.input,
          undefined,
          reaction.name,
        ),
        ...(reaction.deferred === true ? { deferred: true as const } : {}),
      } as StepNode,
    };
    const whereFn = liveOf(reaction) as WhereFn | undefined;
    if (whereFn !== undefined) {
      bound.whereFn = whereFn;
    } else if (reaction.where.length > 0) {
      bound.whereOps = reaction.where.map((op) => {
        if (op.op === "earlier") {
          return {
            op: "earlier" as const,
            pattern: this.bindActionTrigger(op.when, reaction.name),
          };
        }
        this.definitions.assertOpUsable(op, reaction.name, "Reaction");
        return op;
      });
    }
    return bound;
  }

  assertViewDag(views: ViewIR[]): void {
    const batch = new Map(views.map((ir) => [ir.name, ir]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, path: string[]): void => {
      if (done.has(name)) return;
      if (visiting.has(name)) {
        const cycle = [...path.slice(path.indexOf(name)), name].join(" → ");
        throw new Error(`Views form a DAG — this registration has a cycle: ${cycle}.`);
      }
      const ir = batch.get(name);
      if (ir === undefined) return;
      visiting.add(name);
      for (const block of ir.alternatives) {
        for (const op of block) if (viewLineIR(op)) visit(op.view, [...path, name]);
      }
      visiting.delete(name);
      done.add(name);
    };
    for (const ir of views) visit(ir.name, []);
  }

  bindView(ir: ViewIR): RelationView {
    this.assertBindingPartitions("View", ir.name, [
      ["input", ir.ins],
      ["output", ir.outs],
      ["free", ir.bindings],
    ]);
    assertViewShape(`View "${ir.name}"`, ir.outs, ir.promise, ir.holds === true);
    return relationViewWith(
      ir.name,
      ir.ins,
      ir.outs,
      ir.bindings,
      ir.promise,
      ir.alternatives,
      ir.holds === true,
    );
  }

  bindFormer(ir: FormerIR): FormerRef {
    this.assertBindingPartitions("Former", ir.name, [
      ["input", ir.ins],
      ["free", ir.bindings],
    ]);
    return formerRefWith(
      ir.name,
      ir.ins,
      ir.ins.map((input) => Symbol(input)),
      ir.bindings,
      ir.promise,
      ir.body,
    );
  }

  private bindActionTrigger(clause: ActionTriggerIR, reactionName: string): ActionTriggerPattern {
    this.definitions.assertPatternUsable(clause.input, reactionName, "Reaction");
    this.definitions.assertPatternUsable(clause.output, reactionName, "Reaction");
    return this.definitions.resolver.action(
      clause.concept,
      clause.action,
      clause.input,
      clause.output,
      reactionName,
      clause.posture,
      clause.by,
    );
  }

  private bindTrigger(clause: TriggerIR, reactionName: string): TriggerPattern {
    if (clause.kind !== "channel") return this.bindActionTrigger(clause, reactionName);
    this.definitions.assertPatternUsable(clause.pattern, reactionName, "Reaction");
    return {
      channel: clause.channel,
      pattern: clause.pattern,
      except: clause.except.map((name) => this.definitions.resolver.concept(name, reactionName)),
      ...(clause.exceptBy !== undefined ? { exceptBy: [...clause.exceptBy] } : {}),
      ...(clause.by !== undefined ? { by: clause.by } : {}),
    };
  }

  private assertConsequenceUsable(input: PatternIR, site: string): void {
    walkValueTree(input, (node) => {
      if (typeof node !== "object" || node === null) return;
      if (hasMarkerKey(node, "$former") && liveOf(node) === undefined) {
        const name = (node as { $former: { name: string } }).$former.name;
        if (this.definitions.formerNamed(name) === undefined) {
          throw new Error(
            `Reaction "${site}": former "${name}" is not registered — ` +
              "registerFormers(...) before the reactions that respond with it.",
          );
        }
      }
    });
    this.definitions.assertPatternUsable(input, site, "Reaction");
  }

  private assertBindingPartitions(
    kind: "View" | "Former",
    name: string,
    partitions: ReadonlyArray<readonly [string, unknown]>,
  ): void {
    for (const [label, value] of partitions) {
      if (!Array.isArray(value) || !value.every((binding) => typeof binding === "string")) {
        throw new Error(`${kind} "${name}": the ${label} binding bag must be an array of names.`);
      }
    }
    assertSeparateBags(kind, name, partitions as ReadonlyArray<readonly [string, string[]]>);
  }
}
