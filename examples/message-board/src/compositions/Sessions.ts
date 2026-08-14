/**
 * Accounts and browser sessions: registering, signing in and out, and resolving
 * the current user.
 *
 * Authenticating proves a username. Sessioning holds an opaque session for an
 * external subject. Neither names the other; the adaptation lives here.
 */
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";

import { concepts } from "../vocabulary.ts";
import {
  credentialsInput,
  issuedSessionOutput,
  sessionOnlyInput,
  signedOutOutput,
  usernameOutput,
} from "./validators.ts";

const { Authenticating, Sessioning } = concepts;

const Register = endpoint(
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

const SignIn = endpoint(
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

const CurrentUser = endpoint(
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

const SignOut = endpoint(
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

export const composition = {
  EnteringApplication: { Register, SignIn },
  CurrentAccount: { CurrentUser },
  LeavingApplication: { SignOut },
};
