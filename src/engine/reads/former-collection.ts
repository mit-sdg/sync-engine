/** Discover view, fragment, and fused-former dependencies. */

import type { Mapping } from "@engine/reactions/types";
import type { FormerChannel } from "./collection-contracts.ts";
import { isFusedFormer } from "./former-nodes.ts";
import type { FormerRef, FusedFormer } from "./former-nodes.ts";
import { liveOf } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { foldFormerNode } from "./schema.ts";
import { walkValueTree } from "./value-tree.ts";
import { viewLineIR } from "./view-lowering.ts";

export type { FormerChannel } from "./collection-contracts.ts";

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
