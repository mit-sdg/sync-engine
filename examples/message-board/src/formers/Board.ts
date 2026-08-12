import { each, form, former } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";

const { Commenting, Posting } = concepts;

/**
 * Posting owns each post; Commenting owns the attachments whose target is that
 * post identity. Neither concept knows the other exists, so this former is
 * where the two readings are joined.
 */
export const Board = former(
  "the message board",
  (_input, { post, author, content, comment, commentAuthor, commentContent }) =>
    form({
      posts: each(Posting._all({}).is({ post, author, content })).form({
        post,
        author,
        content,
        comments: each(
          Commenting._for({ target: post }).is({
            comment,
            author: commentAuthor,
            content: commentContent,
          }),
        ).form({ comment, author: commentAuthor, content: commentContent }),
      }),
    }),
);
