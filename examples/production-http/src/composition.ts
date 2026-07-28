import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "./concept-set.ts";

const { Naming, Sessioning } = concepts;

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

const emptyInput = validator((value) => hasOnly(value, []), "body must be empty");
const sessionInput = validator(
  (value) =>
    hasOnly(value, ["session"]) && (typeof value.session === "string" || value.session === null),
  "session must be a string or absent cookie",
);
export const StartSession = endpoint(
  "/sessions/start",
  ({ session, expiresAt }) =>
    receive({})
      .then(Sessioning.start({}).responds({ session, expiresAt }))
      .then(respond({ session, expiresAt })),
  {
    input: {},
    validators: {
      input: emptyInput,
      output: validator(
        (value) =>
          hasOnly(value, ["session", "expiresAt"]) &&
          typeof value.session === "string" &&
          value.expiresAt instanceof Date,
        "session response must contain a credential and Date expiry",
      ),
    },
  },
);

export const CurrentSession = endpoint(
  "/sessions/current",
  ({ session, active }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ active }))
      .then(respond({ active })),
  {
    input: { required: ["session"] },
    validators: {
      input: sessionInput,
      output: validator(
        (value) => hasOnly(value, ["active"]) && value.active === true,
        "current response must be active",
      ),
    },
  },
);

export const EndSession = endpoint(
  "/sessions/end",
  ({ session, ended }) =>
    receive({ session })
      .then(Sessioning.end({ session }).responds({ ended }))
      .then(respond({ ended })),
  {
    input: { required: ["session"] },
    validators: {
      input: sessionInput,
      output: validator(
        (value) => hasOnly(value, ["ended"]) && value.ended === true,
        "end response must be ended",
      ),
    },
  },
);

export const ClaimName = endpoint(
  "/names/claim",
  ({ name }) =>
    receive({ name }).then(Naming.claim({ name }).responds({ name })).then(respond({ name })),
  {
    input: { required: ["name"] },
    validators: {
      input: validator(
        (value) =>
          hasOnly(value, ["name"]) &&
          typeof value.name === "string" &&
          value.name.length >= 1 &&
          value.name.length <= 64,
        "name must be a string between 1 and 64 characters",
      ),
      output: validator(
        (value) => hasOnly(value, ["name"]) && typeof value.name === "string",
        "name response must contain a name",
      ),
    },
  },
);
