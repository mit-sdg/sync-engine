export class CommentNotFound extends Error {}
export class CommentAuthorMismatch extends Error {}

type Comment = { comment: string; target: string; author: string; content: string };

export class CommentingConcept {
  private readonly comments: Comment[] = [];

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  add({ target, author, content }: { target: string; author: string; content: string }) {
    const comment = this.freshID();
    this.comments.push({ comment, target, author, content });
    return { comment };
  }

  retract({ comment, author }: { comment: string; author: string }) {
    const index = this.comments.findIndex((entry) => entry.comment === comment);
    if (index < 0) throw new CommentNotFound("There is no such comment.");
    if (this.comments[index].author !== author) {
      throw new CommentAuthorMismatch("Only the comment author may retract it.");
    }
    this.comments.splice(index, 1);
    return { comment };
  }

  _for({ target }: { target: string }): Comment[] {
    return this.comments.filter((entry) => entry.target === target);
  }
}
