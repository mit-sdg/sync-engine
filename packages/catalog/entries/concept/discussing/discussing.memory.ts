import {
  compareResponses,
  DISCUSSION_ALREADY_OPEN_MESSAGE,
  DISCUSSION_NOT_OPEN_MESSAGE,
  DiscussionAlreadyOpen,
  DiscussionNotOpen,
  INVALID_RESPONSE_TEXT_MESSAGE,
  InvalidResponseText,
  responseTextAccepted,
  type DiscussionRecord,
  type ResponseListRow,
  type ResponseRecord,
} from "./discussing.shared.ts";

export class DiscussingMemoryConcept {
  private readonly discussions = new Map<string, DiscussionRecord>();
  private readonly responses = new Map<string, ResponseRecord>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  open({ subject, at }: { subject: string; at: Date }) {
    if (this.#openFor(subject) !== undefined)
      throw new DiscussionAlreadyOpen(DISCUSSION_ALREADY_OPEN_MESSAGE);
    const discussion = this.freshID();
    this.discussions.set(discussion, {
      discussion,
      subject,
      openedAt: new Date(at.getTime()),
      open: true,
    });
    return { discussion };
  }

  respond({
    discussion,
    author,
    text,
    at,
  }: {
    discussion: string;
    author: string;
    text: string;
    at: Date;
  }) {
    if (!responseTextAccepted(text)) throw new InvalidResponseText(INVALID_RESPONSE_TEXT_MESSAGE);
    const found = this.discussions.get(discussion);
    if (found === undefined || !found.open)
      throw new DiscussionNotOpen(DISCUSSION_NOT_OPEN_MESSAGE);
    const response = this.freshID();
    this.responses.set(response, {
      response,
      discussion,
      author,
      text,
      addedAt: new Date(at.getTime()),
    });
    return { response };
  }

  close({ discussion, at }: { discussion: string; at: Date }) {
    const found = this.discussions.get(discussion);
    if (found === undefined || !found.open)
      throw new DiscussionNotOpen(DISCUSSION_NOT_OPEN_MESSAGE);
    this.discussions.set(discussion, {
      ...found,
      open: false,
      closedAt: new Date(at.getTime()),
    });
    return { discussion };
  }

  _openFor({ subject }: { subject: string }): { discussion: string; openedAt: Date }[] {
    const discussion = this.#openFor(subject);
    if (discussion === undefined) return [];
    const found = this.discussions.get(discussion);
    if (found === undefined) return [];
    return [{ discussion, openedAt: new Date(found.openedAt.getTime()) }];
  }

  _responses({ discussion }: { discussion: string }): ResponseListRow[] {
    return [...this.responses.values()]
      .filter((response) => response.discussion === discussion)
      .sort(compareResponses)
      .map(({ response, author, text, addedAt }) => ({
        response,
        author,
        text,
        addedAt: new Date(addedAt.getTime()),
      }));
  }

  _response({ response }: { response: string }): Omit<ResponseRecord, "response">[] {
    const found = this.responses.get(response);
    return found === undefined
      ? []
      : [
          {
            discussion: found.discussion,
            author: found.author,
            text: found.text,
            addedAt: new Date(found.addedAt.getTime()),
          },
        ];
  }

  #openFor(subject: string): string | undefined {
    for (const [discussion, found] of this.discussions)
      if (found.subject === subject && found.open) return discussion;
    return undefined;
  }
}
