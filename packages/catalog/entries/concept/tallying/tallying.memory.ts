import { NothingTallied } from "./tallying.shared.ts";

export class TallyingMemoryConcept {
  private readonly totals = new Map<string, number>();

  raise({ subject }: { subject: string }) {
    const total = (this.totals.get(subject) ?? 0) + 1;
    this.totals.set(subject, total);
    return { subject, total };
  }

  clear({ subject }: { subject: string }) {
    if (!this.totals.delete(subject))
      throw new NothingTallied("That subject has no total to clear.");
    return { subject };
  }

  _total({ subject }: { subject: string }) {
    return { total: this.totals.get(subject) ?? 0 };
  }
}
