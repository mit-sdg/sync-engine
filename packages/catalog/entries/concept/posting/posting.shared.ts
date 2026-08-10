export const INVALID_POST_CONTENT_MESSAGE =
  "Post content must not be blank and must be at most 500 characters.";

export class InvalidPostContent extends Error {
  constructor() {
    super(INVALID_POST_CONTENT_MESSAGE);
  }
}

export interface PostRecord {
  post: string;
  author: string;
  content: string;
  publishedAt: Date;
}
