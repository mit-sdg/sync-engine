import { DiscussionAlreadyOpen, DiscussionNotOpen } from "./errors.ts";

type Discussion = { discussion: string; subject: string; open: boolean };
type Response = { response: string; discussion: string; author: string; text: string };

/** Open discussions about subjects and collect responses while they remain open. */
export class DiscussingConcept {
  static readonly queries = { _openFor: "optional", _responses: "many" } as const;
  private readonly discussions = new Map<string, Discussion>();
  private readonly responses: Response[] = [];

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  open({ subject }: { subject: string }) {
    if (this.#openFor(subject) !== undefined) {
      throw new DiscussionAlreadyOpen("This subject already has an open discussion.");
    }
    const discussion = this.freshID();
    this.discussions.set(discussion, { discussion, subject, open: true });
    return { discussion };
  }

  respond({ discussion, author, text }: { discussion: string; author: string; text: string }) {
    const found = this.discussions.get(discussion);
    if (found === undefined || !found.open) {
      throw new DiscussionNotOpen("This discussion is not open.");
    }
    const response = this.freshID();
    this.responses.push({ response, discussion, author, text });
    return { response };
  }

  close({ discussion }: { discussion: string }) {
    const found = this.discussions.get(discussion);
    if (found === undefined || !found.open) {
      throw new DiscussionNotOpen("This discussion is not open.");
    }
    found.open = false;
    return {};
  }

  _openFor({ subject }: { subject: string }): { discussion: string }[] {
    const discussion = this.#openFor(subject);
    return discussion === undefined ? [] : [{ discussion }];
  }

  _responses({ discussion }: { discussion: string }): Response[] {
    return this.responses.filter((response) => response.discussion === discussion);
  }

  #openFor(subject: string): string | undefined {
    for (const [discussion, entry] of this.discussions) {
      if (entry.subject === subject && entry.open) return discussion;
    }
    return undefined;
  }
}
