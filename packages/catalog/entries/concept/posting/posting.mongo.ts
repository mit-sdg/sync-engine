import type { Collection, Db } from "mongodb";
import { InvalidPostContent, type PostRecord } from "./posting.shared.ts";

const indexes = new WeakMap<Db, Promise<void>>();

export function ensurePostingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const posts = db.collection<PostRecord>("posting_posts");
    ready = Promise.all([
      posts.createIndex({ post: 1 }, { unique: true }),
      posts.createIndex({ publishedAt: 1, post: 1 }),
      posts.createIndex({ author: 1, publishedAt: 1, post: 1 }),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class PostingMongoConcept {
  private readonly posts: Collection<PostRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.posts = db.collection("posting_posts");
  }

  async publish({ author, content, at }: { author: string; content: string; at: Date }) {
    if (content.trim().length === 0 || content.length > 500) throw new InvalidPostContent();
    const publishedAt = new Date(at.getTime());
    await ensurePostingIndexes(this.db);
    const post = this.freshID();
    await this.posts.insertOne({ post, author, content, publishedAt });
    return { post };
  }

  async _all(_input: Record<string, never>): Promise<PostRecord[]> {
    return this.posts
      .find({}, { projection: { _id: 0, post: 1, author: 1, content: 1, publishedAt: 1 } })
      .sort({ publishedAt: 1, post: 1 })
      .toArray();
  }

  async _get({ post }: { post: string }): Promise<Array<Omit<PostRecord, "post">>> {
    const found = await this.posts.findOne(
      { post },
      { projection: { _id: 0, author: 1, content: 1, publishedAt: 1 } },
    );
    return found === null
      ? []
      : [{ author: found.author, content: found.content, publishedAt: found.publishedAt }];
  }

  async _byAuthor({ author }: { author: string }): Promise<Array<Omit<PostRecord, "author">>> {
    return this.posts
      .find({ author }, { projection: { _id: 0, post: 1, content: 1, publishedAt: 1 } })
      .sort({ publishedAt: 1, post: 1 })
      .toArray();
  }
}
