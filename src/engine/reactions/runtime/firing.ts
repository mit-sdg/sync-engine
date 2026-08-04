import type { MemoryStore } from "./log-store.ts";
import { uuid } from "@engine/utils/runtime";
import { redact } from "@engine/utils/redaction";
import type { Redactor } from "@engine/utils/redaction";

export interface FiringFill {
  reaction: string;
  flow: string;
  whenIds: string[];
  bindings: Record<string, unknown>;
  produced: string[];
  marked: boolean;
}

/** Owns the durable and in-flight halves of the double-fire guard. */
export class FiringBook {
  private readonly inFlightConsumed = new Map<string, Set<string>>();

  constructor(
    private readonly store: MemoryStore,
    private readonly admit?: (flow: string) => void,
    private readonly redactor: Redactor = { redact },
  ) {}

  hasConsumed(recordId: string, reaction: string): boolean {
    if (this.store.hasConsumed(recordId, reaction)) return true;
    return this.inFlightConsumed.get(recordId)?.has(reaction) ?? false;
  }

  mark(fill: FiringFill): void {
    if (fill.marked) return;
    this.admit?.(fill.flow);
    fill.marked = true;
    for (const id of fill.whenIds) {
      let reactions = this.inFlightConsumed.get(id);
      if (reactions === undefined) {
        reactions = new Set();
        this.inFlightConsumed.set(id, reactions);
      }
      reactions.add(fill.reaction);
    }
  }

  unmark(fill: FiringFill): void {
    if (!fill.marked) return;
    fill.marked = false;
    for (const id of fill.whenIds) {
      const reactions = this.inFlightConsumed.get(id);
      if (reactions === undefined) continue;
      reactions.delete(fill.reaction);
      if (reactions.size === 0) this.inFlightConsumed.delete(id);
    }
  }

  record(fill: FiringFill): void {
    try {
      if (fill.marked) {
        this.store.append({
          kind: "firing",
          at: Date.now(),
          firing: {
            id: uuid(),
            reaction: fill.reaction,
            flow: fill.flow,
            bindings: this.redactor.redact(fill.bindings) as Record<string, unknown>,
            consumed: fill.whenIds,
            produced: fill.produced,
            at: Date.now(),
          },
        });
      }
    } finally {
      this.unmark(fill);
    }
  }
}
