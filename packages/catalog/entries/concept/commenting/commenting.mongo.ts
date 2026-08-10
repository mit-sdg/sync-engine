import type { Collection, Db } from "mongodb";
import {
  CommentAuthorMismatch,
  CommentNotFound,
  InvalidCommentText,
  type CommentRecord,
} from "./commenting.shared.ts";

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureCommentingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const comments = db.collection<CommentRecord>("commenting_comments");
    ready = Promise.all([
      comments.createIndex({ comment: 1 }, { unique: true }),
      comments.createIndex({ target: 1, addedAt: 1, comment: 1 }),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class CommentingMongoConcept {
  private readonly comments: Collection<CommentRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.comments = db.collection("commenting_comments");
  }

  async add({
    target,
    author,
    text,
    at,
  }: {
    target: string;
    author: string;
    text: string;
    at: Date;
  }) {
    if (text.trim().length === 0 || text.length > 1000) throw new InvalidCommentText();
    const addedAt = new Date(at.getTime());
    await ensureCommentingIndexes(this.db);
    const comment = this.freshID();
    await this.comments.insertOne({ comment, target, author, text, addedAt });
    return { comment };
  }

  async retract({ comment, author }: { comment: string; author: string }) {
    await ensureCommentingIndexes(this.db);
    const removed = await this.comments.findOneAndDelete({ comment, author });
    if (removed !== null) return { comment };

    const existing = await this.comments.findOne(
      { comment },
      { projection: { _id: 0, author: 1 } },
    );
    if (existing === null) throw new CommentNotFound();
    throw new CommentAuthorMismatch();
  }

  async _for({ target }: { target: string }): Promise<Array<Omit<CommentRecord, "target">>> {
    return this.comments
      .find({ target }, { projection: { _id: 0, comment: 1, author: 1, text: 1, addedAt: 1 } })
      .sort({ addedAt: 1, comment: 1 })
      .toArray();
  }

  async _get({ comment }: { comment: string }): Promise<Array<Omit<CommentRecord, "comment">>> {
    const found = await this.comments.findOne(
      { comment },
      { projection: { _id: 0, target: 1, author: 1, text: 1, addedAt: 1 } },
    );
    return found === null
      ? []
      : [{ target: found.target, author: found.author, text: found.text, addedAt: found.addedAt }];
  }
}
