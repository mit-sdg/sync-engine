/**
 * Accounts and browser sessions: registering, signing in and out, and resolving
 * the current user.
 *
 * Authenticating proves a username. Sessioning holds an opaque session for an
 * external subject. Neither names the other; the adaptation lives here.
 */
import spec from "@design/compositions/Sessions.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";

export { spec };
import { concepts } from "../vocabulary.ts";
import {
  credentialsInput,
  issuedSessionOutput,
  sessionOnlyInput,
  signedOutOutput,
  usernameOutput,
} from "./validators.ts";

const { Authenticating, Sessioning } = concepts;

export const Register = endpoint(
  "/auth/register",
  ({ username, password, session, expiresAt }) =>
    receive({ username, password })
      .then(Authenticating.register({ username, password }).responds({ username }))
      .then(Sessioning.start({ subject: username }).responds({ session, expiresAt }))
      .then(respond({ username, session, expiresAt })),
  {
    input: { required: ["username", "password"] },
    validators: { input: credentialsInput, output: issuedSessionOutput },
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
    validators: { input: credentialsInput, output: issuedSessionOutput },
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
