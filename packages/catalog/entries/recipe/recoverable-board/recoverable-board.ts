import spec from "./spec.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Commenting, Labeling, Posting, Timing, Trashing } = concepts;
const BOARD_SCOPE = "recoverable-board";

const PostExists = view("recoverable board Post (post) exists", ({ post }, _outputs, _bindings) =>
  where(Posting._get({ post })),
).holds();

const PostIsVisible = view(
  "recoverable board Post (post) is visible",
  ({ post }, _outputs, _bindings) =>
    where(Posting._get({ post }), Trashing._state({ item: post }).is({ status: "active" })),
).holds();

const BoardLabel = view(
  "Label (label) belongs to the recoverable board",
  ({ label }, _outputs, _bindings) => where(Labeling._get({ label }).is({ scope: BOARD_SCOPE })),
).holds();

const RecoverableBoard = former(
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

const PublishBoardPost = endpoint("/recoverable-board/post", ({ author, content, at, post }) =>
  receive({ author, content })
    .where(Timing._now({}).is({ time: at }))
    .then(Posting.publish({ author, content, at }).responds({ post }))
    .then(respond({ post })),
);

const AddBoardComment = endpoint(
  "/recoverable-board/comment",
  ({ post, author, text, at, comment }) =>
    receive({ post, author, text }).then(
      where(PostIsVisible({ post }), Timing._now({}).is({ time: at }))
        .then(Commenting.add({ target: post, author, text, at }).responds({ comment }))
        .then(respond({ comment }))
        .named("visible-post"),
      where(no(PostIsVisible({ post })))
        .then(respond({ error: "POST_NOT_VISIBLE" }))
        .named("hidden-or-missing-post"),
    ),
);

const RetractBoardComment = endpoint("/recoverable-board/retract-comment", ({ comment, author }) =>
  receive({ comment, author })
    .then(Commenting.retract({ comment, author }).responds({ comment }))
    .then(respond({ comment })),
);

const CreateBoardLabel = endpoint("/recoverable-board/create-label", ({ name, label }) =>
  receive({ name })
    .then(Labeling.create({ scope: BOARD_SCOPE, name }).responds({ label }))
    .then(respond({ label })),
);

const LabelBoardPost = endpoint("/recoverable-board/label", ({ post, label }) =>
  receive({ post, label }).then(
    where(PostIsVisible({ post }), BoardLabel({ label }))
      .then(Labeling.apply({ label, item: post }).responds({ label, item: post }))
      .then(respond({ post, label }))
      .named("visible-post-and-board-label"),
    where(no(PostIsVisible({ post })))
      .then(respond({ error: "POST_NOT_VISIBLE" }))
      .named("hidden-or-missing-post"),
    where(PostIsVisible({ post }), no(BoardLabel({ label })))
      .then(respond({ error: "LABEL_NOT_ON_BOARD" }))
      .named("foreign-or-missing-label"),
  ),
);

const UnlabelBoardPost = endpoint("/recoverable-board/unlabel", ({ post, label }) =>
  receive({ post, label }).then(
    where(PostExists({ post }), BoardLabel({ label }))
      .then(Labeling.remove({ label, item: post }).responds({ label, item: post }))
      .then(respond({ post, label }))
      .named("post-and-board-label"),
    where(no(PostExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("missing-post"),
    where(PostExists({ post }), no(BoardLabel({ label })))
      .then(respond({ error: "LABEL_NOT_ON_BOARD" }))
      .named("foreign-or-missing-label"),
  ),
);

const TrashBoardPost = endpoint("/recoverable-board/trash", ({ post, at }) =>
  receive({ post }).then(
    where(PostExists({ post }), Timing._now({}).is({ time: at }))
      .then(Trashing.trash({ item: post, at }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(PostExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

const RestoreBoardPost = endpoint("/recoverable-board/restore", ({ post }) =>
  receive({ post }).then(
    where(PostExists({ post }))
      .then(Trashing.restore({ item: post }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(PostExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

const PurgeBoardPost = endpoint("/recoverable-board/purge", ({ post, at }) =>
  receive({ post }).then(
    where(PostExists({ post }), Timing._now({}).is({ time: at }))
      .then(Trashing.purge({ item: post, at }).responds({ item: post }))
      .then(respond({ post }))
      .named("post-exists"),
    where(no(PostExists({ post })))
      .then(respond({ error: "POST_NOT_FOUND" }))
      .named("post-missing"),
  ),
);

const ListRecoverableBoard = endpoint("/recoverable-board/list", () =>
  receive({}).then(respond({ board: RecoverableBoard({}) })),
);

export { spec };

export const compositions = {
  BoardContent: { PublishBoardPost, AddBoardComment, RetractBoardComment },
  BoardLabels: { CreateBoardLabel, LabelBoardPost, UnlabelBoardPost },
  PostRecovery: { TrashBoardPost, RestoreBoardPost, PurgeBoardPost },
  BoardPages: { ListRecoverableBoard },
};
export const views = { PostExists, PostIsVisible, BoardLabel };
export const formers = { RecoverableBoard };
