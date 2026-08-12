/**
 * The board itself: reading it, publishing a post, and attaching or retracting
 * a comment.
 *
 * Every endpoint here resolves the session subject first and passes it on as
 * Posting's or Commenting's `Author`, so a request never chooses its own author.
 */
import spec from "@design/compositions/Board.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../vocabulary.ts";
import { Board } from "../formers/Board.ts";

export { spec };
import {
  boardOutput,
  commentOutput,
  postOutput,
  sessionCommentIdInput,
  sessionCommentInput,
  sessionContentInput,
  sessionOnlyInput,
} from "./validators.ts";

const { Commenting, Posting, Sessioning } = concepts;

export const ListBoard = endpoint(
  "/board/list",
  ({ session, username }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(respond({ board: Board({}) })),
  {
    input: { required: ["session"] },
    validators: { input: sessionOnlyInput, output: boardOutput },
  },
);

export const PublishPost = endpoint(
  "/board/post",
  ({ session, username, content, post }) =>
    receive({ session, content })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Posting.publish({ author: username, content }).responds({ post }))
      .then(respond({ post })),
  {
    input: { required: ["session", "content"] },
    validators: { input: sessionContentInput, output: postOutput },
  },
);

/**
 * Commenting accepts any target identity, by design. Requiring the post to
 * exist is this application's decision, so it is a sibling split here rather
 * than a refusal inside the concept.
 */
export const AddComment = endpoint(
  "/board/comment",
  ({ session, username, target, content, comment }) =>
    receive({ session, target, content })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(
        where(Posting._get({ post: target }))
          .then(Commenting.add({ target, author: username, content }).responds({ comment }))
          .then(respond({ comment }))
          .named("post-exists"),
        where(no(Posting._get({ post: target })))
          .then(respond({ error: "POST_NOT_FOUND" }))
          .named("post-missing"),
      ),
  {
    input: { required: ["session", "target", "content"] },
    validators: { input: sessionCommentInput, output: commentOutput },
  },
);

/**
 * Commenting enforces the author rule itself, so this endpoint passes the
 * session subject as the claimed author and lets COMMENT_AUTHOR_MISMATCH
 * answer. The rule holds for a direct concept call too, not only this route.
 */
export const RetractComment = endpoint(
  "/board/retract-comment",
  ({ session, username, comment }) =>
    receive({ session, comment })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Commenting.retract({ comment, author: username }).responds({ comment }))
      .then(respond({ comment })),
  {
    input: { required: ["session", "comment"] },
    validators: { input: sessionCommentIdInput, output: commentOutput },
  },
);
