import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "./concept-set.ts";

const { Naming, Sessioning } = concepts;

export const StartSession = endpoint(
  "/sessions/start",
  ({ user, session, expiresAt }) =>
    receive({ user })
      .then(Sessioning.start({ user }).responds({ session, expiresAt, user }))
      .then(respond({ session, expiresAt, user })),
  { input: { required: ["user"] } },
);

export const CurrentSession = endpoint(
  "/sessions/current",
  ({ session, user }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ user }))
      .then(respond({ user })),
  { input: { required: ["session"] } },
);

export const EndSession = endpoint(
  "/sessions/end",
  ({ session, ended }) =>
    receive({ session })
      .then(Sessioning.end({ session }).responds({ ended }))
      .then(respond({ ended })),
  { input: { required: ["session"] } },
);

export const ClaimName = endpoint(
  "/names/claim",
  ({ name }) =>
    receive({ name }).then(Naming.claim({ name }).responds({ name })).then(respond({ name })),
  { input: { required: ["name"] } },
);
