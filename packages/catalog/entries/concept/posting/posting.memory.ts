import { InvalidPostContent, type PostRecord } from "./posting.shared.ts";

interface OrderedPost {
  post: string;
  publishedAt: Date;
}

function comparePosts(left: OrderedPost, right: OrderedPost): number {
  const byTime = left.publishedAt.getTime() - right.publishedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.post < right.post ? -1 : left.post > right.post ? 1 : 0;
}

function copyPost(record: PostRecord): PostRecord {
  return { ...record, publishedAt: new Date(record.publishedAt.getTime()) };
}

export class PostingMemoryConcept {
  private readonly posts = new Map<string, PostRecord>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  publish({ author, content, at }: { author: string; content: string; at: Date }) {
    if (content.trim().length === 0 || content.length > 500) throw new InvalidPostContent();
    const post = this.freshID();
    this.posts.set(post, {
      post,
      author,
      content,
      publishedAt: new Date(at.getTime()),
    });
    return { post };
  }

  _all(_input: Record<string, never>): PostRecord[] {
    return [...this.posts.values()].map(copyPost).sort(comparePosts);
  }

  _get({ post }: { post: string }): Array<Omit<PostRecord, "post">> {
    const found = this.posts.get(post);
    return found === undefined
      ? []
      : [
          {
            author: found.author,
            content: found.content,
            publishedAt: new Date(found.publishedAt.getTime()),
          },
        ];
  }

  _byAuthor({ author }: { author: string }): Array<Omit<PostRecord, "author">> {
    return [...this.posts.values()]
      .filter((record) => record.author === author)
      .map(({ post, content, publishedAt }) => ({
        post,
        content,
        publishedAt: new Date(publishedAt.getTime()),
      }))
      .sort(comparePosts);
  }
}
