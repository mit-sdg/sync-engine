/**
 * Discover view, fragment, and fused-former dependencies, collect them
 * transitively in registration order, and serialize one registered
 * application's reactions, views, and formers.
 */

import type { Mapping } from "@engine/reactions/types";
import { isFusedFormer } from "./former-nodes.ts";
import type { FormerRef, FusedFormer } from "./former-nodes.ts";
import { serializeFormer } from "./former-lowering.ts";
import { liveOf } from "./ir.ts";
import type { AppIR, ReactionIR, UnloweredIR, ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { foldFormerNode } from "./schema.ts";
import { walkValueTree } from "./value-tree.ts";
import { serializeView, viewLineIR } from "./view-lowering.ts";

/** A named dependency plus its optional definition-site live reference. */
export interface FormerChannel<T> {
  name: string;
  live?: T;
}

/** Every view a former's selections consult, by name. */
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

/** Every fragment a former's records splice. */
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

/** Every view referenced by reactions and formers, transitively. */
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

/** Serialize one registered application's reactions, views, and formers. */
export function serializeApp(
  registered: Iterable<ReactionIR[]>,
  unlowered: Iterable<UnloweredIR>,
  formers: Iterable<FormerRef> = [],
  viewOf: (name: string) => RelationView | undefined = () => undefined,
): AppIR {
  const groups = [...registered];
  const formerRefs = [...formers];
  return {
    reactions: groups.flat(),
    views: collectViews(groups, formerRefs, viewOf).map((ref) => serializeView(ref)),
    formers: formerRefs.map((ref) => serializeFormer(ref)),
    unlowered: [...unlowered],
  };
}
