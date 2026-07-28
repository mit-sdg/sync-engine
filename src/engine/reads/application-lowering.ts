/** Serialize one registered application's reactions, views, and formers. */

import { serializeFormer } from "./former-lowering.ts";
import type { FormerRef } from "./former-nodes.ts";
import type { AppIR, ReactionIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { collectViews } from "./view-collection.ts";
import { serializeView } from "./view-lowering.ts";

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
