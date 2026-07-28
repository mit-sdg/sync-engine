/** Collect transitive view dependencies in registration order. */

import type { FormerChannel } from "./collection-contracts.ts";
import { viewChannelsOfFormer } from "./former-collection.ts";
import type { FormerRef } from "./former-nodes.ts";
import { liveOf } from "./ir.ts";
import type { ReactionIR, ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { viewLineIR } from "./view-lowering.ts";

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
