import { AlreadyRegistered, NotRegistered } from "./registering.shared.ts";

export class RegisteringMemoryConcept {
  private readonly subjectByOccurrence = new Map<string, string>();

  register({ subject, occurrence }: { subject: string; occurrence: string }) {
    if (this.subjectByOccurrence.has(occurrence))
      throw new AlreadyRegistered("That occurrence has already been registered.");
    this.subjectByOccurrence.set(occurrence, subject);
    return { registration: occurrence };
  }

  deregister({ occurrence }: { occurrence: string }) {
    if (!this.subjectByOccurrence.delete(occurrence))
      throw new NotRegistered("That occurrence was never registered.");
    return {};
  }

  _registration({ occurrence }: { occurrence: string }) {
    const subject = this.subjectByOccurrence.get(occurrence);
    return subject === undefined ? [] : [{ subject }];
  }

  _registrations({ subject }: { subject: string }) {
    const rows: { occurrence: string }[] = [];
    for (const [occurrence, registered] of this.subjectByOccurrence)
      if (registered === subject) rows.push({ occurrence });
    return rows;
  }
}
