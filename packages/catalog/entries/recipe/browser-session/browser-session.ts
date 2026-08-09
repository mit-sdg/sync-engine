import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { no, where } from "@mit-sdg/sync-engine/language";
import {
  httpPolicy,
  type HttpCookiePolicy,
  type HttpPolicy,
  type HttpPublicErrorCategory,
} from "@mit-sdg/sync-engine-http/server";
import { concepts } from "@catalog/concepts";

const { Authenticating, Profiling, Sessioning } = concepts;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function identifier(value: unknown): value is string {
  return boundedString(value, 1, 128) && value.trim() !== "";
}

function displayName(value: unknown): value is string {
  return boundedString(value, 1, 128) && value.trim() !== "";
}

function session(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validator(
  accepts: (value: Record<string, unknown>) => boolean,
  detail: string,
): EndpointValidator {
  return (value) => (record(value) && accepts(value) ? { ok: true } : { ok: false, detail });
}

function domainErrors(...codes: string[]): EndpointValidator {
  const allowed = new Set(codes);
  return (value) =>
    typeof value === "string" && allowed.has(value)
      ? { ok: true }
      : { ok: false, detail: `error must be one of ${codes.join(", ")}` };
}

const registerInput = validator(
  (value) =>
    hasOnly(value, ["identifier", "secret", "displayName"]) &&
    identifier(value.identifier) &&
    boundedString(value.secret, 8, 1_024) &&
    displayName(value.displayName),
  "identifier and displayName must be non-blank strings of 1-128 characters and secret 8-1024",
);

const signInInput = validator(
  (value) =>
    hasOnly(value, ["identifier", "secret"]) &&
    typeof value.identifier === "string" &&
    typeof value.secret === "string",
  "identifier and secret must be strings",
);

const protectedInput = validator(
  (value) => hasOnly(value, ["session"]) && session(value.session),
  "session must be null or an opaque string of 1-128 characters",
);

function identityFields(value: Record<string, unknown>): boolean {
  return (
    boundedString(value.profile, 1, 128) &&
    displayName(value.displayName) &&
    validDate(value.expiresAt)
  );
}

const issuedIdentityOutput = validator(
  (value) =>
    hasOnly(value, ["session", "expiresAt", "profile", "displayName"]) &&
    boundedString(value.session, 1, 128) &&
    identityFields(value),
  "response must contain a bounded session and profile identity with a valid expiry",
);

const currentIdentityOutput = validator(
  (value) => hasOnly(value, ["profile", "displayName", "expiresAt"]) && identityFields(value),
  "response must contain exactly one bounded profile identity with a valid expiry",
);

const signOutOutput = validator(
  (value) => hasOnly(value, ["signedOut"]) && value.signedOut === true,
  "response must contain signedOut true",
);

const signOutAllOutput = validator(
  (value) =>
    hasOnly(value, ["signedOut", "endedCount"]) &&
    value.signedOut === true &&
    typeof value.endedCount === "number" &&
    Number.isSafeInteger(value.endedCount) &&
    value.endedCount >= 0,
  "response must contain signedOut true and a nonnegative endedCount",
);

const registerErrors = domainErrors(
  "DISPLAY_NAME_REQUIRED",
  "IDENTIFIER_ALREADY_REGISTERED",
  "INVALID_IDENTIFIER",
  "INVALID_SECRET",
  "PROFILE_ALREADY_EXISTS",
);
const signInErrors = domainErrors("INVALID_CREDENTIALS", "PROFILE_NOT_FOUND");
const currentErrors = domainErrors("PROFILE_NOT_FOUND", "UNKNOWN_SESSION");
const sessionErrors = domainErrors("UNKNOWN_SESSION");

export const Register = endpoint(
  "/auth/register",
  ({
    identifier,
    secret,
    displayName,
    principal,
    profile,
    storedDisplayName,
    session,
    expiresAt,
  }) =>
    receive({ identifier, secret, displayName })
      .then(Authenticating.register({ identifier, secret }).responds({ principal }))
      .then(
        where(
          Profiling._forPrincipal({ principal }).is({ profile, displayName: storedDisplayName }),
        )
          .then(
            Sessioning.start({ principal, profile, displayName: storedDisplayName }).responds({
              session,
              expiresAt,
            }),
          )
          .then(respond({ session, expiresAt, profile, displayName: storedDisplayName }))
          .named("resume"),
        where(no(Profiling._forPrincipal({ principal })))
          .then(Profiling.create({ principal, displayName }).responds({ profile }))
          .then(
            Sessioning.start({ principal, profile, displayName }).responds({ session, expiresAt }),
          )
          .then(respond({ session, expiresAt, profile, displayName }))
          .named("create-profile"),
      ),
  {
    input: { required: ["identifier", "secret", "displayName"] },
    validators: { input: registerInput, output: issuedIdentityOutput, domainError: registerErrors },
  },
);

export const SignIn = endpoint(
  "/auth/sign-in",
  ({ identifier, secret, principal, profile, displayName, session, expiresAt }) =>
    receive({ identifier, secret })
      .then(Authenticating.authenticate({ identifier, secret }).responds({ principal }))
      .then(
        where(Profiling._forPrincipal({ principal }).is({ profile, displayName }))
          // Causal fields travel on the action record; Sessioning owns only principal.
          .then(
            Sessioning.start({ principal, profile, displayName }).responds({ session, expiresAt }),
          )
          .then(respond({ session, expiresAt, profile, displayName }))
          .named("profile"),
        where(no(Profiling._forPrincipal({ principal })))
          .then(respond({ error: "PROFILE_NOT_FOUND" }))
          .named("missing-profile"),
      ),
  {
    input: { required: ["identifier", "secret"] },
    validators: { input: signInInput, output: issuedIdentityOutput, domainError: signInErrors },
  },
);

export const CurrentSession = endpoint(
  "/auth/session",
  ({ session, principal, expiresAt, profile, displayName }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ principal, expiresAt }))
      .then(
        where(Profiling._forPrincipal({ principal }).is({ profile, displayName }))
          .then(respond({ profile, displayName, expiresAt }))
          .named("profile"),
        where(no(Profiling._forPrincipal({ principal })))
          .then(respond({ error: "PROFILE_NOT_FOUND" }))
          .named("missing-profile"),
      ),
  {
    input: { required: ["session"] },
    validators: { input: protectedInput, output: currentIdentityOutput, domainError: currentErrors },
  },
);

export const RotateSession = endpoint(
  "/auth/session/rotate",
  ({ session, replacement, principal, expiresAt, profile, displayName }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ principal }))
      .then(
        where(Profiling._forPrincipal({ principal }).is({ profile, displayName }))
          .then(
            Sessioning.rotate({ session, profile, displayName }).responds({
              replacement,
              expiresAt,
            }),
          )
          .then(respond({ session: replacement, expiresAt, profile, displayName }))
          .named("profile"),
        where(no(Profiling._forPrincipal({ principal })))
          .then(respond({ error: "PROFILE_NOT_FOUND" }))
          .named("missing-profile"),
      ),
  {
    input: { required: ["session"] },
    validators: { input: protectedInput, output: issuedIdentityOutput, domainError: currentErrors },
  },
);

export const SignOut = endpoint(
  "/auth/sign-out",
  ({ session }) =>
    receive({ session })
      .then(Sessioning.end({ session }))
      .then(respond({ signedOut: true })),
  {
    input: { required: ["session"] },
    validators: { input: protectedInput, output: signOutOutput, domainError: sessionErrors },
  },
);

export const SignOutAll = endpoint(
  "/auth/sign-out-all",
  ({ session, principal, expiresAt, endedCount }) =>
    receive({ session })
      .then(Sessioning.current({ session }).responds({ principal, expiresAt }))
      .then(Sessioning.endAll({ principal }).responds({ endedCount }))
      .then(respond({ signedOut: true, endedCount })),
  {
    input: { required: ["session"] },
    validators: { input: protectedInput, output: signOutAllOutput, domainError: sessionErrors },
  },
);

export interface BrowserSessionCookieOptions {
  name?: string;
  sameSite?: HttpCookiePolicy["sameSite"];
  path?: string;
  domain?: string;
  origins?: readonly string[];
}

export interface BrowserSessionHttpPolicyOptions {
  origin: string;
  basePath?: string;
  publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
  cookie?: BrowserSessionCookieOptions;
}

const defaultPublicErrors: Readonly<Record<string, HttpPublicErrorCategory>> = {
  DISPLAY_NAME_REQUIRED: "INVALID_REQUEST",
  IDENTIFIER_ALREADY_REGISTERED: "CONFLICT",
  INVALID_CREDENTIALS: "UNAUTHORIZED",
  INVALID_IDENTIFIER: "INVALID_REQUEST",
  INVALID_SECRET: "INVALID_REQUEST",
  PROFILE_ALREADY_EXISTS: "CONFLICT",
  PROFILE_NOT_FOUND: "UNAUTHORIZED",
  UNKNOWN_SESSION: "UNAUTHORIZED",
};

/** Bind the recipe's fixed credential fields to one safely customizable cookie. */
export function browserSessionHttpPolicy(options: BrowserSessionHttpPolicyOptions): HttpPolicy {
  const cookie = options.cookie ?? {};
  return httpPolicy({
    origin: options.origin,
    ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
    publicErrors: { ...defaultPublicErrors, ...options.publicErrors },
    cookie: {
      name: cookie.name ?? "session",
      input: "session",
      issue: [
        { path: Register.path, value: "session", expires: "expiresAt" },
        { path: SignIn.path, value: "session", expires: "expiresAt" },
        { path: RotateSession.path, value: "session", expires: "expiresAt" },
      ],
      clear: [SignOut.path, SignOutAll.path],
      ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
      ...(cookie.path === undefined ? {} : { path: cookie.path }),
      ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
      ...(cookie.origins === undefined ? {} : { origins: cookie.origins }),
    },
  });
}
