import {
  CommentAuthorMismatch,
  CommentNotFound,
  InvalidCommentText,
  type CommentRecord,
} from "./commenting.shared.ts";

interface OrderedComment {
  comment: string;
  addedAt: Date;
}

function compareComments(left: OrderedComment, right: OrderedComment): number {
  const byTime = left.addedAt.getTime() - right.addedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.comment < right.comment ? -1 : left.comment > right.comment ? 1 : 0;
}

export class CommentingMemoryConcept {
  private readonly comments = new Map<string, CommentRecord>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  add({ target, author, text, at }: { target: string; author: string; text: string; at: Date }) {
    if (text.trim().length === 0 || text.length > 1000) throw new InvalidCommentText();
    const comment = this.freshID();
    this.comments.set(comment, {
      comment,
      target,
      author,
      text,
      addedAt: new Date(at.getTime()),
    });
    return { comment };
  }

  retract({ comment, author }: { comment: string; author: string }) {
    const found = this.comments.get(comment);
    if (found === undefined) throw new CommentNotFound();
    if (found.author !== author) throw new CommentAuthorMismatch();
    this.comments.delete(comment);
    return { comment };
  }

  _for({ target }: { target: string }): Array<Omit<CommentRecord, "target">> {
    return [...this.comments.values()]
      .filter((record) => record.target === target)
      .map(({ comment, author, text, addedAt }) => ({
        comment,
        author,
        text,
        addedAt: new Date(addedAt.getTime()),
      }))
      .sort(compareComments);
  }

  _get({ comment }: { comment: string }): Array<Omit<CommentRecord, "comment">> {
    const found = this.comments.get(comment);
    return found === undefined
      ? []
      : [
          {
            target: found.target,
            author: found.author,
            text: found.text,
            addedAt: new Date(found.addedAt.getTime()),
          },
        ];
  }
}
