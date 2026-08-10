import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Authenticating, Commenting, Posting, Sessioning, Timing } = concepts;

const postTargetExists = view("the Post target exists (post)", ({ post }, _outputs, _bindings) =>
  where(Posting._get({ post })),
).holds();

const postTargetIsMissing = view(
  "the Post target is missing (post)",
  ({ post }, _outputs, _bindings) => where(no(Posting._get({ post }))),
).holds();

const messageBoard = former(
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

export const RegisterBoardUser = endpoint(
  "/message-board/register",
  ({ username, password, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.register({ username, password }).responds({ username }))
      .then(Sessioning.start({ subject: username }).responds({ session, expiresAt }))
      .then(respond({ username, session, expiresAt })),
);

export const SignInBoardUser = endpoint(
  "/message-board/sign-in",
  ({ username, password, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.authenticate({ username, password }).responds({ username }))
      .then(Sessioning.start({ subject: username }).responds({ session, expiresAt }))
      .then(respond({ username, session, expiresAt })),
);

export const CurrentBoardUser = endpoint("/message-board/current-user", ({ session, username }) =>
  receive({ session })
    .then(Sessioning.current({ session }).responds({ subject: username }))
    .then(respond({ username })),
);

export const SignOutBoardUser = endpoint("/message-board/sign-out", ({ session, signedOut }) =>
  receive({ session })
    .then(Sessioning.end({ session }).responds({ ended: signedOut }))
    .then(respond({ signedOut })),
);

export const ChangeBoardPassword = endpoint(
  "/message-board/change-password",
  ({ session, username, currentPassword, newPassword }) =>
    receive({ session, currentPassword, newPassword })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(
        Authenticating.changePassword({
          username,
          currentPassword,
          newPassword,
        }).responds({ username }),
      )
      .then(respond({ username })),
);

export const DeleteBoardAccount = endpoint(
  "/message-board/delete-account",
  ({ session, username, password }) =>
    receive({ session, password })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Authenticating.unregister({ username, password }).responds({ username }))
      .then(respond({ username })),
);

export const PublishMessageBoardPost = endpoint(
  "/message-board/post",
  ({ session, author, content, time, post }) =>
    receive({ session, content })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(
        where(Timing._now({}).is({ time })).then(
          Posting.publish({ author, content, at: time }).responds({ post }),
        ),
      )
      .then(respond({ post })),
);

export const AddMessageBoardComment = endpoint(
  "/message-board/comment",
  ({ session, author, target, text, time, comment }) =>
    receive({ session, target, text })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(
        where(postTargetExists({ post: target }), Timing._now({}).is({ time }))
          .then(Commenting.add({ target, author, text, at: time }).responds({ comment }))
          .then(respond({ comment }))
          .named("post-exists"),
        where(postTargetIsMissing({ post: target }))
          .then(respond({ error: "POST_NOT_FOUND" }))
          .named("post-missing"),
      ),
);

export const RetractMessageBoardComment = endpoint(
  "/message-board/retract-comment",
  ({ session, author, comment }) =>
    receive({ session, comment })
      .then(Sessioning.current({ session }).responds({ subject: author }))
      .then(Commenting.retract({ comment, author }).responds({ comment }))
      .then(respond({ comment })),
);

export const ListMessageBoard = endpoint("/message-board/list", ({ session }) =>
  receive({ session })
    .then(Sessioning.current({ session }).responds({}))
    .then(respond({ board: messageBoard({}) })),
);
