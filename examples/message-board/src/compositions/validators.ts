/**
 * Runtime endpoint validators shared by the composition modules.
 *
 * Generated TypeScript types constrain callers that compile against the wire;
 * these functions reject the untyped values a real request can carry. This
 * module holds no declarations, so assembly never walks it.
 */
import type { EndpointValidator } from "@mit-sdg/sync-engine/boundary";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validator(
  accepts: (value: Record<string, unknown>) => boolean,
  detail: string,
): EndpointValidator {
  return (value) => (record(value) && accepts(value) ? { ok: true } : { ok: false, detail });
}

/** A session input always arrives from the cookie binding, or not at all. */
function fromCookie(value: Record<string, unknown>): boolean {
  return typeof value.session === "string" || value.session === null;
}

export const credentialsInput = validator(
  (value) =>
    hasOnly(value, ["username", "password"]) &&
    typeof value.username === "string" &&
    typeof value.password === "string" &&
    value.username.length <= 32 &&
    value.password.length <= 128,
  "username and password must be bounded strings",
);

export const sessionOnlyInput = validator(
  (value) => hasOnly(value, ["session"]) && fromCookie(value),
  "session must be a string or absent cookie",
);

export const sessionContentInput = validator(
  (value) =>
    hasOnly(value, ["session", "content"]) &&
    fromCookie(value) &&
    typeof value.content === "string" &&
    value.content.length <= 500,
  "content must be a bounded string and session must come from the cookie",
);

export const sessionCommentInput = validator(
  (value) =>
    hasOnly(value, ["session", "target", "content"]) &&
    fromCookie(value) &&
    typeof value.target === "string" &&
    value.target.length > 0 &&
    value.target.length <= 128 &&
    typeof value.content === "string" &&
    value.content.length > 0 &&
    value.content.length <= 500,
  "target and content must be bounded strings and session must come from the cookie",
);

export const sessionCommentIdInput = validator(
  (value) =>
    hasOnly(value, ["session", "comment"]) &&
    fromCookie(value) &&
    typeof value.comment === "string" &&
    value.comment.length > 0 &&
    value.comment.length <= 128,
  "comment must be a bounded string and session must come from the cookie",
);

export const usernameOutput = validator(
  (value) => hasOnly(value, ["username"]) && typeof value.username === "string",
  "response must contain a username",
);

export const signedOutOutput = validator(
  (value) => hasOnly(value, ["signedOut"]) && value.signedOut === true,
  "response must confirm sign-out",
);

export const postOutput = validator(
  (value) => hasOnly(value, ["post"]) && typeof value.post === "string",
  "response must contain a post identity",
);

export const commentOutput = validator(
  (value) => hasOnly(value, ["comment"]) && typeof value.comment === "string",
  "response must contain a comment identity",
);

export const issuedSessionOutput = validator(
  (value) =>
    hasOnly(value, ["account", "session", "expiresAt"]) &&
    typeof value.account === "string" &&
    typeof value.session === "string" &&
    value.expiresAt instanceof Date,
  "response must contain account, session, and Date expiry",
);

export function validBoard(value: Record<string, unknown>): boolean {
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

export const boardOutput = validator(
  (value) => hasOnly(value, ["board"]) && record(value.board) && validBoard(value.board),
  "response must contain a valid board",
);
