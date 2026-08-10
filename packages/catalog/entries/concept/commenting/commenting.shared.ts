export const INVALID_COMMENT_TEXT_MESSAGE =
  "A comment must not be blank and must be at most 1000 characters.";
export const COMMENT_NOT_FOUND_MESSAGE = "There is no such comment.";
export const COMMENT_AUTHOR_MISMATCH_MESSAGE = "Only the comment author may retract it.";

export class InvalidCommentText extends Error {
  constructor() {
    super(INVALID_COMMENT_TEXT_MESSAGE);
  }
}

export class CommentNotFound extends Error {
  constructor() {
    super(COMMENT_NOT_FOUND_MESSAGE);
  }
}

export class CommentAuthorMismatch extends Error {
  constructor() {
    super(COMMENT_AUTHOR_MISMATCH_MESSAGE);
  }
}

export interface CommentRecord {
  comment: string;
  target: string;
  author: string;
  text: string;
  addedAt: Date;
}
