/** Validate registered views and formers against one assembly's read vocabulary. */

import type { NameResolver } from "@engine/reactions/resolving";
import type { ComputationRef } from "./computations.ts";
import type { FormerRef } from "./former-nodes.ts";
import { asMarker, liveOf } from "./ir.ts";
import type { FormerNodeIR, PatternIR, ViewOpIR, WhereOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { varNamesInPattern } from "./former-analysis.ts";
import { isPlainObject } from "./matchers.ts";
import { foldFormerNode } from "./schema.ts";
import { opNamesIR, scheduleBlock } from "./schedule.ts";
import { walkValueTree } from "./value-tree.ts";
import { viewLineIR } from "./view-lowering.ts";
import type { QueryPromise } from "./query-metadata.ts";

type DefinitionKind = "Former" | "View" | "Reaction";

export class ViewFormerValidator {
  private readonly formable = new WeakSet<FormerRef>();
  private readonly usableViews = new WeakSet<object>();

  constructor(
    private readonly definitions: {
      resolver: NameResolver;
      viewNamed(name: string): RelationView | undefined;
      formerNamed(name: string): FormerRef | undefined;
      resolveAuthoredComputation(ref: ComputationRef, site: string): ComputationRef;
    },
  ) {}

  assertFormable(ref: FormerRef): void {
    if (this.formable.has(ref)) return;
    const site = ref.formerName;
    this.assertFormerBindings(ref.body, new Set(ref.ins), site);
    foldFormerNode(ref.body, {
      query: (query) =>
        this.definitions.resolver.query(query.concept, query.query, `Former "${site}"`),
      pattern: (pattern) => this.assertPatternUsable(pattern, site, "Former"),
      node: (node) => {
        if (node.node !== "former") return;
        const nested =
          (liveOf(node) as FormerRef | undefined) ?? this.definitions.formerNamed(node.former);
        if (nested === undefined) {
          throw new Error(`Former "${site}": named former "${node.former}" is not registered.`);
        }
      },
      op: (op) => {
        if (op.op === "earlier") {
          throw new Error(
            `Former "${site}": a former answers from standing state — earlier(...) cannot appear in its selections.`,
          );
        }
        this.assertOpUsable(op, site, "Former");
      },
      splice: (use) => {
        const fragment = liveOf(use) as FormerRef | undefined;
        if (fragment !== undefined) this.assertFormable(fragment);
        else if (this.definitions.formerNamed(use.fragment) === undefined) {
          throw new Error(
            `Former "${site}": spliced fragment "${use.fragment}" resolves against ` +
              "the engine's registered formers — register dependencies first.",
          );
        }
      },
    });
    this.formable.add(ref);
  }

  assertViewUsable(ref: RelationView): void {
    if (this.usableViews.has(ref)) return;
    const site = ref.viewName;
    const ins = ref.ins;
    const outs = ref.outs;
    for (const block of ref.alternatives as readonly (readonly ViewOpIR[])[]) {
      const scheduled = scheduleBlock(block, new Set(ins), `View "${site}"`);
      for (const out of outs) {
        if (!scheduled.bound.has(out)) {
          throw new Error(
            `View "${site}": an alternative never binds the declared output "${out}".`,
          );
        }
      }
      this.lintOpenedNames(scheduled.ordered, scheduled.opens, [...ins, ...outs], `View "${site}"`);
      for (const op of block) {
        if ((op as { op: string }).op === "earlier") {
          throw new Error(
            `View "${site}": a view answers from standing state, not from the ` +
              "flow's record — earlier(...) belongs to a reaction's own where.",
          );
        }
        this.assertOpUsable(op, site, "View");
        if (viewLineIR(op)) {
          const nested =
            (liveOf(op) as RelationView | undefined) ?? this.definitions.viewNamed(op.view);
          if (nested !== undefined) this.assertViewUsable(nested);
        }
      }
    }
    if (outs.length === 0 && !ref.holdsPredicate) {
      throw new Error(`View "${site}": an empty output binding bag must end in holds().`);
    }
    if (outs.length > 0 && ref.holdsPredicate) {
      throw new Error(`View "${site}": holds() requires an empty output binding bag.`);
    }
    if (outs.length > 0 && ref.promise === undefined) {
      throw new Error(
        `View "${site}": an output view must carry its one, optional, or many promise.`,
      );
    }
    this.usableViews.add(ref);
  }

  assertOpUsable(op: ViewOpIR, site: string, kind: DefinitionKind): void {
    switch (op.op) {
      case "find":
      case "whether":
      case "no":
        if (viewLineIR(op)) {
          if (liveOf(op) === undefined && this.definitions.viewNamed(op.view) === undefined) {
            throw new Error(
              `${kind} "${site}": view "${op.view}" is not registered — ` +
                "registerViews(...) before the reactions that ask it.",
            );
          }
        } else if (op.query !== undefined) {
          this.definitions.resolver.query(op.query.concept, op.query.query, `${kind} "${site}"`);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      case "count":
        this.definitions.resolver.query(op.query.concept, op.query.query, `${kind} "${site}"`);
        this.assertPatternUsable(op.in, site, kind);
        break;
      case "holds": {
        const installed = liveOf(op) as ComputationRef | undefined;
        if (installed !== undefined) {
          this.definitions.resolveAuthoredComputation(installed, `${kind} "${site}"`);
        } else {
          this.definitions.resolver.computation(op.computation, `${kind} "${site}"`);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      }
      case "compute": {
        const installed = liveOf(op) as ComputationRef | undefined;
        if (installed !== undefined) {
          this.definitions.resolveAuthoredComputation(installed, `${kind} "${site}"`);
        } else {
          this.definitions.resolver.computation(op.computation, `${kind} "${site}"`, true);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      }
      case "custom":
        if (liveOf(op) === undefined) {
          throw new Error(
            `${kind} "${site}": a custom op (${op.fnRef}) is opaque code and cannot be ` +
              "re-registered from data.",
          );
        }
        break;
    }
  }

  assertPatternUsable(pattern: unknown, site: string, kind: DefinitionKind): void {
    walkValueTree(pattern, (node) => {
      if (!isPlainObject(node)) return;
      const marker = asMarker(node);
      if (marker === null) return;
      const invalid = (() => {
        switch (marker.tag) {
          case "$var":
            return typeof marker.payload === "string" ? undefined : "a string name";
          case "$oneOf":
            return Array.isArray(marker.payload) ? undefined : "an array";
          case "$regexp": {
            if (
              typeof marker.payload !== "object" ||
              marker.payload === null ||
              typeof (marker.payload as { source?: unknown }).source !== "string" ||
              typeof (marker.payload as { flags?: unknown }).flags !== "string"
            ) {
              return "string source and flags";
            }
            try {
              new RegExp(
                (marker.payload as { source: string }).source,
                (marker.payload as { flags: string }).flags,
              );
              return undefined;
            } catch {
              return "valid regular-expression source and flags";
            }
          }
          case "$is":
            if (typeof marker.payload !== "string") return "a string description";
            return liveOf(node) === undefined ? "its definition-site matcher" : undefined;
          case "$former":
            return typeof marker.payload === "object" && marker.payload !== null
              ? undefined
              : "a former description";
          case "$lit":
            return typeof marker.payload === "object" && marker.payload !== null
              ? undefined
              : "an object literal";
        }
      })();
      if (invalid !== undefined) {
        throw new Error(`${kind} "${site}": marker "${marker.tag}" requires ${invalid}.`);
      }
      return false;
    });
  }

  private assertFormerBindings(
    node: FormerNodeIR,
    inherited: ReadonlySet<string>,
    site: string,
  ): void {
    const requireBound = (pattern: PatternIR, phrase: string, scope: ReadonlySet<string>): void => {
      for (const name of varNamesInPattern(pattern)) {
        if (!scope.has(name)) {
          throw new Error(`Former "${site}": ${phrase} uses "${name}" before it is bound.`);
        }
      }
    };
    if (node.node === "leaf") {
      if (!inherited.has(node.var)) {
        throw new Error(`Former "${site}": leaf "${node.var}" is bound by nothing.`);
      }
      return;
    }
    if (node.node === "record") {
      const scheduled = scheduleBlock(node.where ?? [], inherited, `Former "${site}"`);
      if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
      for (const op of scheduled.ordered) {
        if (op.op !== "find" && op.op !== "whether") continue;
        const opens = scheduled.opens.get(op) ?? [];
        if (opens.length > 0 && this.lineRefPromise(op, `Former "${site}"`) === "many") {
          throw new Error(
            `Former "${site}": this record's where may match many rows; ` +
              "wrap the source in each(...) when the result should contain rows.",
          );
        }
      }
      for (const child of Object.values(node.entries)) {
        this.assertFormerBindings(child, scheduled.bound, site);
      }
      for (const splice of node.splices ?? []) {
        requireBound(splice.in, `splice "${splice.fragment}" anchor`, scheduled.bound);
      }
      return;
    }
    if (node.node === "former") {
      requireBound(node.in, `former "${node.former}" anchor`, inherited);
      return;
    }
    if (node.from.op !== "find") {
      throw new Error(
        `Former "${site}": each(...) starts production from one plain query or view line.`,
      );
    }
    requireBound(node.from.in, "each(...) input", inherited);
    requireBound(node.from.not ?? {}, "each(...).is.not(...) test", inherited);
    const scope = new Set(inherited);
    for (const name of varNamesInPattern(node.from.out)) scope.add(name);
    const scheduled = scheduleBlock(node.where ?? [], scope, `Former "${site}"`);
    if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
    const afterWhere = scheduled.bound;
    if (node.node === "each") this.assertFormerBindings(node.as, afterWhere, site);
    if (
      (node.node === "count" || node.node === "first" || node.node === "distinct") &&
      this.lineRefPromise(node.from, `Former "${site}"`) !== "many"
    ) {
      throw new Error(
        `Former "${site}": the source already promises at most one row; ` +
          "use a plain line or whether(...), not a fold.",
      );
    }
    if ((node.node === "first" || node.node === "distinct") && !afterWhere.has(node.value)) {
      throw new Error(
        `Former "${site}": ${node.node}(...) value "${node.value}" is bound by nothing.`,
      );
    }
    if (
      (node.node === "each" || node.node === "first") &&
      node.arranged !== undefined &&
      "by" in node.arranged &&
      !afterWhere.has(node.arranged.by)
    ) {
      throw new Error(
        `Former "${site}": arranged(...) value "${node.arranged.by}" is bound by nothing.`,
      );
    }
  }

  private lineRefPromise(
    op: Extract<ViewOpIR, { op: "find" | "whether" | "no" }>,
    diagnosticSite: string,
  ): QueryPromise {
    if (viewLineIR(op)) {
      const nested =
        (liveOf(op) as RelationView | undefined) ?? this.definitions.viewNamed(op.view);
      return nested?.promise ?? "optional";
    }
    if (op.query === undefined) return "many";
    return (
      this.definitions.resolver.query(op.query.concept, op.query.query, diagnosticSite)
        .queryPromise ?? "many"
    );
  }

  private lintOpenedNames(
    ordered: readonly (WhereOpIR | ViewOpIR)[],
    opens: ReadonlyMap<WhereOpIR | ViewOpIR, string[]>,
    extra: readonly string[],
    site: string,
  ): void {
    const counts = new Map<string, number>();
    const add = (name: string): void => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    for (const op of ordered) for (const name of opNamesIR(op)) add(name);
    for (const name of extra) add(name);
    for (const op of ordered) {
      if (op.op === "earlier") continue;
      for (const name of opens.get(op) ?? []) {
        if ((counts.get(name) ?? 0) <= 1) {
          throw new Error(`${site}: "${name}" is opened and never used — omit the key instead.`);
        }
      }
    }
  }
}
