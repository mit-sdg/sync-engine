import spec from "./spec.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, now, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Authenticating, Commenting, Posting, Sessioning } = concepts;

const PostTargetExists = view("the Post target exists (post)", ({ post }, _outputs, _bindings) =>
  where(Posting._get({ post })),
).holds();

const PostTargetIsMissing = view(
  "the Post target is missing (post)",
  ({ post }, _outputs, _bindings) => where(no(Posting._get({ post }))),
).holds();

const MessageBoard = former(
  "the message board",
  (_input, { post, postAuthor, content, publishedAt, comment, commentAuthor, text, addedAt }) =>
    form({
      posts: each(Posting._all({}).is({ post, author: postAuthor, content, publishedAt })).form({
        post,
        author: postAuthor,
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
      }),
    }),
);

const RegisterBoardUser = endpoint(
  "/message-board/register",
  ({ username, password, account, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.register({ username, password }).responds({ account }))
      .then(Sessioning.start({ subject: account }).responds({ session, expiresAt }))
      .then(respond({ account, session, expiresAt })),
);

const SignInBoardUser = endpoint(
  "/message-board/sign-in",
  ({ username, password, account, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.authenticate({ username, password }).responds({ account }))
      .then(Sessioning.start({ subject: account }).responds({ session, expiresAt }))
      .then(respond({ account, session, expiresAt })),
);

const CurrentBoardUser = endpoint("/message-board/current-user", ({ session, username }) =>
  receive({ session })
    .then(Sessioning.current({ session }).responds({ subject: username }))
    .then(respond({ username })),
);

const SignOutBoardUser = endpoint("/message-board/sign-out", ({ session, signedOut }) =>
  receive({ session })
    .then(Sessioning.end({ session }).responds({ ended: signedOut }))
    .then(respond({ signedOut })),
);

const ChangeBoardPassword = endpoint(
  "/message-board/change-password",
  ({ session, username, currentPassword, newPassword, account }) =>
    receive({ session, currentPassword, newPassword })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(
        Authenticating.changePassword({
          username,
          currentPassword,
          newPassword,
        }).responds({ account }),
      )
      .then(respond({ account })),
);

const DeleteBoardAccount = endpoint(
  "/message-board/delete-account",
  ({ session, username, password, account }) =>
    receive({ session, password })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Authenticating.unregister({ username, password }).responds({ account }))
      .then(respond({ account })),
);

const PublishMessageBoardPost = endpoint(
  "/message-board/post",
  ({ session, author, content, time, post }) =>
    receive({ session, content })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(
        where(now(time)).then(Posting.publish({ author, content, at: time }).responds({ post })),
      )
      .then(respond({ post })),
);

const AddMessageBoardComment = endpoint(
  "/message-board/comment",
  ({ session, author, target, text, time, comment }) =>
    receive({ session, target, text })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(
        where(PostTargetExists({ post: target }), now(time))
          .then(Commenting.add({ target, author, text, at: time }).responds({ comment }))
          .then(respond({ comment }))
          .named("post-exists"),
        where(PostTargetIsMissing({ post: target }))
          .then(respond({ error: "POST_NOT_FOUND" }))
          .named("post-missing"),
      ),
);

const RetractMessageBoardComment = endpoint(
  "/message-board/retract-comment",
  ({ session, author, comment }) =>
    receive({ session, comment })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(Commenting.retract({ comment, author }).responds({ comment }))
      .then(respond({ comment })),
);

const ListMessageBoard = endpoint("/message-board/list", ({ session }) =>
  receive({ session })
    .then(Sessioning.current({ session }).responds({}))
    .then(respond({ board: MessageBoard({}) })),
);

export { spec };

export const compositions = {
  Accounts: {
    RegisterBoardUser,
    SignInBoardUser,
    CurrentBoardUser,
    SignOutBoardUser,
    ChangeBoardPassword,
    DeleteBoardAccount,
  },
  BoardPublishing: { PublishMessageBoardPost, AddMessageBoardComment, RetractMessageBoardComment },
  BoardPages: { ListMessageBoard },
};
export const views = { PostTargetExists, PostTargetIsMissing };
export const formers = { MessageBoard };
