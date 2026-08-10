export class InvalidPostContent extends Error {}

type Post = { post: string; author: string; content: string };

export class PostingConcept {
  private readonly posts: Post[] = [];

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  publish({ author, content }: { author: string; content: string }) {
    if (content.trim().length === 0 || content.length > 500) {
      throw new InvalidPostContent("Post content must contain 1 to 500 non-whitespace characters.");
    }
    const post = this.freshID();
    this.posts.push({ post, author, content });
    return { post };
  }

  _all(_input: Record<string, never>): Post[] {
    return [...this.posts];
  }

  _get({ post }: { post: string }): Post[] {
    const found = this.posts.find((entry) => entry.post === post);
    return found === undefined ? [] : [found];
  }
}
