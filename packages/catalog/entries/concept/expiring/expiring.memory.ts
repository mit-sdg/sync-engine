import { AlreadyScheduled, DeadlineInPast, NoDeadline } from "./expiring.shared.ts";

export class ExpiringMemoryConcept {
  private readonly deadlines = new Map<string, string>();

  schedule({ subject, expiresAt, now }: { subject: string; expiresAt: string; now: string }) {
    if (this.deadlines.has(subject))
      throw new AlreadyScheduled("That subject already has a deadline.");
    this.#requireFuture(expiresAt, now);
    this.deadlines.set(subject, expiresAt);
    return { subject };
  }

  reschedule({ subject, expiresAt, now }: { subject: string; expiresAt: string; now: string }) {
    if (!this.deadlines.has(subject)) throw new NoDeadline("That subject has no deadline.");
    this.#requireFuture(expiresAt, now);
    this.deadlines.set(subject, expiresAt);
    return { subject };
  }

  cancel({ subject }: { subject: string }) {
    if (!this.deadlines.delete(subject)) throw new NoDeadline("That subject has no deadline.");
    return { subject };
  }

  _deadline({ subject }: { subject: string }) {
    const expiresAt = this.deadlines.get(subject);
    return expiresAt === undefined ? [] : [{ expiresAt }];
  }

  _lapsed({ subject, now }: { subject: string; now: string }) {
    const expiresAt = this.deadlines.get(subject);
    return { lapsed: expiresAt !== undefined && Date.parse(expiresAt) <= Date.parse(now) };
  }

  #requireFuture(expiresAt: string, now: string): void {
    if (Date.parse(expiresAt) > Date.parse(now)) return;
    throw new DeadlineInPast("A deadline must fall after the current instant.");
  }
}
