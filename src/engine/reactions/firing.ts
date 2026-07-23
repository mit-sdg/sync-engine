import type { FiringRecord, LogStore } from "./log-store.ts";
import { uuid } from "../utils/runtime.ts";
import { redact } from "../utils/redaction.ts";

export interface FiringFill {
  reaction: string;
  flow: string;
  whenIds: string[];
  bindings: Record<string, unknown>;
  produced: string[];
  branches: FiringBranch[];
}

export interface FiringBranch {
  fill: FiringFill;
  marked: boolean;
}

/** Owns the durable and in-flight halves of the double-fire guard. */
export class FiringBook {
  private readonly inFlightConsumed = new Map<string, Map<string, number>>();

  constructor(private readonly store: LogStore) {}

  hasConsumed(recordId: string | undefined, reaction: string): boolean {
    if (recordId === undefined) return false;
    if (this.store.hasConsumed(recordId, reaction)) return true;
    return (this.inFlightConsumed.get(recordId)?.get(reaction) ?? 0) > 0;
  }

  newBranch(fill: FiringFill): FiringBranch {
    const branch = { fill, marked: false };
    fill.branches.push(branch);
    return branch;
  }

  mark(branch: FiringBranch): void {
    if (branch.marked) return;
    branch.marked = true;
    for (const id of branch.fill.whenIds) {
      let byReaction = this.inFlightConsumed.get(id);
      if (byReaction === undefined) {
        byReaction = new Map();
        this.inFlightConsumed.set(id, byReaction);
      }
      byReaction.set(branch.fill.reaction, (byReaction.get(branch.fill.reaction) ?? 0) + 1);
    }
  }

  unmark(branch: FiringBranch): void {
    if (!branch.marked) return;
    branch.marked = false;
    for (const id of branch.fill.whenIds) {
      const byReaction = this.inFlightConsumed.get(id);
      const count = byReaction?.get(branch.fill.reaction);
      if (byReaction === undefined || count === undefined) continue;
      if (count <= 1) {
        byReaction.delete(branch.fill.reaction);
        if (byReaction.size === 0) this.inFlightConsumed.delete(id);
      } else {
        byReaction.set(branch.fill.reaction, count - 1);
      }
    }
  }

  record(fill: FiringFill): void {
    if (fill.branches.some((branch) => branch.marked)) {
      this.store.append({
        kind: "firing",
        at: Date.now(),
        firing: {
          id: uuid(),
          reaction: fill.reaction,
          flow: fill.flow,
          bindings: redact(fill.bindings) as Record<string, unknown>,
          consumed: fill.whenIds,
          produced: fill.produced,
          at: Date.now(),
        },
      });
    }
    for (const branch of fill.branches) this.unmark(branch);
  }

  firings(reaction: string): FiringRecord[] {
    return this.store.firingsByReaction(reaction);
  }
}
