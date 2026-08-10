import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Authenticating, Commenting, Posting, Sessioning } = concepts;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validator(
  accepts: (value: Record<string, unknown>) => boolean,
  detail: string,
): EndpointValidator {
  return (value) => (record(value) && accepts(value) ? { ok: true } : { ok: false, detail });
}

const credentialsInput = validator(
  (value) =>
    hasOnly(value, ["username", "password"]) &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    value.username.length <= 32 &&
    value.password.length <= 128,
  "username and password must be bounded strings",
);
const sessionOnlyInput = validator(
  (value) =>
    hasOnly(value, ["session"]) && (typeof value.session === "string" || value.session === null),
  "session must be a string or absent cookie",
);
const sessionContentInput = validator(
  (value) =>
    hasOnly(value, ["session", "content"]) &&
    (typeof value.session === "string" || value.session === null) &&
    typeof value.content === "string" &&
    value.content.length <= 500,
  "content must be a bounded string and session must come from the cookie",
);
const sessionCommentInput = validator(
  (value) =>
    hasOnly(value, ["session", "target", "content"]) &&
    (typeof value.session === "string" || value.session === null) &&
    typeof value.target === "string" &&
    value.target.length > 0 &&
    value.target.length <= 128 &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    value.content.length <= 500,
  "target and content must be bounded strings and session must come from the cookie",
);
const usernameOutput = validator(
  (value) => hasOnly(value, ["username"]) && typeof value.username === "string",
  "response must contain a username",
);
const signedOutOutput = validator(
  (value) => hasOnly(value, ["signedOut"]) && value.signedOut === true,
  "response must confirm sign-out",
);
const postOutput = validator(
  (value) => hasOnly(value, ["post"]) && typeof value.post === "string",
  "response must contain a post identity",
);
const commentOutput = validator(
  (value) => hasOnly(value, ["comment"]) && typeof value.comment === "string",
  "response must contain a comment identity",
);

function validBoard(value: Record<string, unknown>): boolean {
  if (!hasOnly(value, ["posts"]) || !Array.isArray(value.posts)) return false;
  return value.posts.every(
    (post) =>
      record(post) &&
      hasOnly(post, ["post", "author", "content", "comments"]) &&
      typeof post.post === "string" &&
      typeof post.author === "string" &&
      typeof post.content === "string" &&
      Array.isArray(post.comments) &&
      post.comments.every(
        (comment) =>
          record(comment) &&
          hasOnly(comment, ["comment", "author", "content"]) &&
          typeof comment.comment === "string" &&
          typeof comment.author === "string" &&
          typeof comment.content === "string",
      ),
  );
}

export const board = former(
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

export const Register = endpoint(
  "/auth/register",
  ({ username, password, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.register({ username, password }).responds({ username }))
      .then(Sessioning.start({ subject: username }).responds({ session, expiresAt }))
      .then(respond({ username, session, expiresAt })),
  {
    input: { required: ["username", "password"] },
    validators: {
      input: credentialsInput,
      output: validator(
        (value) =>
          hasOnly(value, ["username", "session", "expiresAt"]) &&
          typeof value.username === "string" &&
          typeof value.session === "string" &&
          value.expiresAt instanceof Date,
        "registration response must contain username, session, and Date expiry",
      ),
    },
  },
);

export const SignIn = endpoint(
  "/auth/sign-in",
  ({ username, password, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.authenticate({ username, password }).responds({ username }))
      .then(Sessioning.start({ subject: username }).responds({ session, expiresAt }))
      .then(respond({ username, session, expiresAt })),
  {
    input: { required: ["username", "password"] },
    validators: {
      input: credentialsInput,
      output: validator(
        (value) =>
          hasOnly(value, ["username", "session", "expiresAt"]) &&
          typeof value.username === "string" &&
          typeof value.session === "string" &&
          value.expiresAt instanceof Date,
        "sign-in response must contain username, session, and Date expiry",
      ),
    },
  },
);

export const CurrentUser = endpoint(
  "/auth/current",
  ({ session, username }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(respond({ username })),
  {
    input: { required: ["session"] },
    validators: { input: sessionOnlyInput, output: usernameOutput },
  },
);

export const SignOut = endpoint(
  "/auth/sign-out",
  ({ session, signedOut }) =>
    receive({ session })
      .then(Sessioning.end({ session }).responds({ ended: signedOut }))
      .then(respond({ signedOut })),
  {
    input: { required: ["session"] },
    validators: { input: sessionOnlyInput, output: signedOutOutput },
  },
);

export const ListBoard = endpoint(
  "/board/list",
  ({ session, username }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(respond({ board: board({}) })),
  {
    input: { required: ["session"] },
    validators: {
      input: sessionOnlyInput,
      output: validator(
        (value) => hasOnly(value, ["board"]) && record(value.board) && validBoard(value.board),
        "response must contain a valid board",
      ),
    },
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
