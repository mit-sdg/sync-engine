import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Commenting, Labeling, Posting, Timing, Trashing } = concepts;
const BOARD_SCOPE = "recoverable-board";

const postExists = view("recoverable board Post (post) exists", ({ post }, _outputs, _bindings) =>
  where(Posting._get({ post })),
).holds();

const postIsVisible = view(
  "recoverable board Post (post) is visible",
  ({ post }, _outputs, _bindings) =>
    where(Posting._get({ post }), Trashing._state({ item: post }).is({ status: "active" })),
).holds();

const boardLabel = view(
  "Label (label) belongs to the recoverable board",
  ({ label }, _outputs, _bindings) => where(Labeling._get({ label }).is({ scope: BOARD_SCOPE })),
).holds();

const recoverableBoard = former(
  "the recoverable board",
  (
    _input,
    { post, author, content, publishedAt, comment, commentAuthor, text, addedAt, label, labelName },
  ) =>
    form({
      posts: each(Posting._all({}).is({ post, author, content, publishedAt }))
        .where(Trashing._state({ item: post }).is({ status: "active" }))
        .form({
          post,
          author,
          content,
          publishedAt,
          comments: each(
            Commenting._for({ target: post }).is({
              comment,
              author: commentAuthor,
              text,
              addedAt,
            }),
          ).form({ comment, author: commentAuthor, text, addedAt }),
          labels: each(
            Labeling._for({ scope: BOARD_SCOPE, item: post }).is({
              label,
              name: labelName,
            }),
          ).form({ label, name: labelName }),
        }),
    }),
);

export const PublishBoardPost = endpoint(
  "/recoverable-board/post",
  ({ author, content, at, post }) =>
    receive({ author, content })
      .where(Timing._now({}).is({ time: at }))
      .then(Posting.publish({ author, content, at }).responds({ post }))
      .then(respond({ post })),
);

export const AddBoardComment = endpoint(
  "/recoverable-board/comment",
  ({ post, author, text, at, comment }) =>
    receive({ post, author, text }).then(
      where(postIsVisible({ post }), Timing._now({}).is({ time: at }))
        .then(Commenting.add({ target: post, author, text, at }).responds({ comment }))
        .then(respond({ comment }))
        .named("visible-post"),
      where(no(postIsVisible({ post })))
        .then(respond({ error: "POST_NOT_VISIBLE" }))
        .named("hidden-or-missing-post"),
    ),
);

export const RetractBoardComment = endpoint(
  "/recoverable-board/retract-comment",
  ({ comment, author }) =>
    receive({ comment, author })
      .then(Commenting.retract({ comment, author }).responds({ comment }))
      .then(respond({ comment })),
);

export const CreateBoardLabel = endpoint("/recoverable-board/create-label", ({ name, label }) =>
  receive({ name })
    .then(Labeling.create({ scope: BOARD_SCOPE, name }).responds({ label }))
    .then(respond({ label })),
);

export const LabelBoardPost = endpoint("/recoverable-board/label", ({ post, label }) =>
  receive({ post, label }).then(
    where(postIsVisible({ post }), boardLabel({ label }))
      .then(Labeling.apply({ label, item: post }).responds({ label, item: post }))
      .then(respond({ post, label }))
      .named("visible-post-and-board-label"),
    where(no(postIsVisible({ post })))
      .then(respond({ error: "POST_NOT_VISIBLE" }))
      .named("hidden-or-missing-post"),
    where(postIsVisible({ post }), no(boardLabel({ label })))
      .then(respond({ error: "LABEL_NOT_ON_BOARD" }))
      .named("foreign-or-missing-label"),
  ),
);

export const UnlabelBoardPost = endpoint("/recoverable-board/unlabel", ({ post, label }) =>
  receive({ post, label }).then(
    where(postExists({ post }), boardLabel({ label }))
      .then(Labeling.remove({ label, item: post }).responds({ label, item: post }))
      .then(respond({ post, label }))
      .named("post-and-board-label"),
    where(no(postExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("missing-post"),
    where(postExists({ post }), no(boardLabel({ label })))
      .then(respond({ error: "LABEL_NOT_ON_BOARD" }))
      .named("foreign-or-missing-label"),
  ),
);

export const TrashBoardPost = endpoint("/recoverable-board/trash", ({ post, at }) =>
  receive({ post }).then(
    where(postExists({ post }), Timing._now({}).is({ time: at }))
      .then(Trashing.trash({ item: post, at }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(postExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

export const RestoreBoardPost = endpoint("/recoverable-board/restore", ({ post }) =>
  receive({ post }).then(
    where(postExists({ post }))
      .then(Trashing.restore({ item: post }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(postExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

export const PurgeBoardPost = endpoint("/recoverable-board/purge", ({ post, at }) =>
  receive({ post }).then(
    where(postExists({ post }), Timing._now({}).is({ time: at }))
      .then(Trashing.purge({ item: post, at }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(postExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

export const ListRecoverableBoard = endpoint("/recoverable-board/list", () =>
  receive({}).then(respond({ board: recoverableBoard({}) })),
);
