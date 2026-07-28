/** Add reaction-branch chaining to a core read/view where block. */

import type { BranchChain, UnnamedStepNode } from "../types.ts";
import { branchChain } from "./nodes.ts";
import type { Condition, WhereOp } from "@engine/reads/where-ops";
import { isCountOp, where as viewWhere, type CountOp, type ViewBlock } from "@engine/reads/views";

export interface AuthoredWhereBlock extends ViewBlock {
  then(node: UnnamedStepNode): BranchChain;
}

/** State a read conjunction, optionally qualifying one reaction branch with it. */
export function where(...conditions: Array<Condition | CountOp>): AuthoredWhereBlock {
  const block = viewWhere(...conditions) as AuthoredWhereBlock;
  Object.defineProperty(block, "then", {
    value: (...nodes: UnnamedStepNode[]) => {
      if (nodes.length !== 1) {
        throw new Error("a branch-local then(...) takes one callable action line.");
      }
      if (block.some(isCountOp)) {
        throw new Error(
          "count(...) cannot be used in a reaction condition. " +
            "To return a row count, use each(line).count() in a former. " +
            "To test a count as policy, define a view and read that view.",
        );
      }
      return branchChain(block as WhereOp[], nodes[0]);
    },
  });
  return block;
}
