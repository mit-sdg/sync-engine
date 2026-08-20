/** Validate registered views and formers against one assembly's read vocabulary. */

import type { NameResolver } from "@engine/reactions/resolving";
import type { ComputationRef } from "./computations.ts";
import type { FormerRef } from "./former-nodes.ts";
import { asMarker, liveOf } from "./ir.ts";
import type { ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { isPlainObject } from "./matchers.ts";
import { assertFormerBindings } from "./former-bindings.ts";
import { foldFormerNode } from "./schema.ts";
import { assertNoOrphanedOpens, scheduleBlock } from "./schedule.ts";
import { walkValueTree } from "./value-tree.ts";
import { viewLineIR } from "./view-lowering.ts";
import { assertViewShape } from "./views.ts";
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
    assertFormerBindings(ref.body, new Set(ref.ins), site, {
      promiseOf: (line, diagnosticSite) => this.lineRefPromise(line, diagnosticSite),
    });
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
        if (op.op === "earlier" || op.op === "now") {
          const word = op.op === "earlier" ? "earlier" : "now";
          throw new Error(
            `Former "${site}": a former answers from standing state — ${word}(...) cannot appear in its selections.`,
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
      assertNoOrphanedOpens(scheduled, [...ins, ...outs], `View "${site}"`);
      for (const op of block) {
        const kind = (op as { op: string }).op;
        if (kind === "earlier" || kind === "now") {
          const word = kind === "earlier" ? "earlier" : "now";
          throw new Error(
            `View "${site}": a view answers from standing state, not from the ` +
              `current flow — ${word}(...) belongs to a reaction's own where.`,
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
    assertViewShape(`View "${site}"`, outs, ref.promise, ref.holdsPredicate);
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
      if (marker.tag === "$lit") {
        for (const value of Object.values(marker.payload as Record<string, unknown>)) {
          this.assertPatternUsable(value, site, kind);
        }
      }
      return marker.tag === "$oneOf";
    });
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
}
