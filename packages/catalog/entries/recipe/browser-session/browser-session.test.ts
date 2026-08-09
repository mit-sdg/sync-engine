import {
  browserSessionHttpPolicy,
  CurrentSession,
  Register,
  RotateSession,
  SignIn,
  SignOut,
  SignOutAll,
} from "@catalog/recipe";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function accepts(
  validator: ((value: unknown) => { ok: boolean }) | undefined,
  value: unknown,
): boolean {
  if (validator === undefined) throw new Error("A browser-session endpoint validator is absent.");
  return validator(value).ok;
}

const declarations = [Register, SignIn, CurrentSession, RotateSession, SignOut, SignOutAll];
assert(declarations.every(Boolean), "A browser-session endpoint declaration is absent.");
assert(
  declarations.map(({ path }) => path).join(",") ===
    [
      "/auth/register",
      "/auth/sign-in",
      "/auth/session",
      "/auth/session/rotate",
      "/auth/sign-out",
      "/auth/sign-out-all",
    ].join(","),
  "A browser-session endpoint path changed.",
);

const registration = {
  identifier: "mina/exact",
  secret: "correct horse battery staple",
  displayName: "Mina",
};
assert(accepts(Register.validators?.input, registration), "Register rejected its exact input.");
assert(
  !accepts(Register.validators?.input, { ...registration, principal: "caller-claim" }) &&
    !accepts(Register.validators?.input, { ...registration, identifier: " " }) &&
    !accepts(Register.validators?.input, { ...registration, secret: "short" }),
  "Register does not enforce its exact bounded input shape.",
);
assert(
  accepts(SignIn.validators?.input, { identifier: "", secret: "short" }) &&
    !accepts(SignIn.validators?.input, { identifier: "mina/exact", secret: 7 }) &&
    !accepts(SignIn.validators?.input, {
      identifier: "mina/exact",
      secret: "bounded secret",
      profile: "caller-claim",
    }),
  "SignIn accepts an identity claim or rejects its credential shape.",
);

for (const endpoint of [CurrentSession, RotateSession, SignOut, SignOutAll]) {
  assert(endpoint.input?.required?.join(",") === "session", `${endpoint.path} does not require session.`);
  assert(
    accepts(endpoint.validators?.input, { session: null }) &&
      accepts(endpoint.validators?.input, { session: "" }) &&
      accepts(endpoint.validators?.input, { session: "opaque-session" }) &&
      accepts(endpoint.validators?.input, { session: "s".repeat(129) }) &&
      !accepts(endpoint.validators?.input, { session: 7 }) &&
      !accepts(endpoint.validators?.input, { session: "opaque", principal: "claim" }),
    `${endpoint.path} does not enforce its protected exact input.`,
  );
}

const expiry = new Date("2030-01-01T00:30:00.000Z");
assert(
  accepts(Register.validators?.output, {
    session: "opaque-session",
    expiresAt: expiry,
    profile: "profile-1",
    displayName: "Mina",
  }) &&
    !accepts(Register.validators?.output, {
      session: "opaque-session",
      expiresAt: expiry.toISOString(),
      profile: "profile-1",
      displayName: "Mina",
    }) &&
    accepts(CurrentSession.validators?.output, {
      profile: "profile-1",
      displayName: "Mina",
      expiresAt: expiry,
    }),
  "Identity output validators do not enforce their exact runtime shape.",
);
assert(
  accepts(Register.validators?.domainError, "IDENTIFIER_ALREADY_REGISTERED") &&
    accepts(SignIn.validators?.domainError, "INVALID_CREDENTIALS") &&
    accepts(CurrentSession.validators?.domainError, "UNKNOWN_SESSION") &&
    !accepts(CurrentSession.validators?.domainError, "INVALID_CREDENTIALS"),
  "Endpoint domain-error validators do not match their owner failures.",
);
assert(
  accepts(SignOutAll.validators?.output, { signedOut: true, endedCount: 0 }),
  "SignOutAll rejected a valid zero count at an expiry boundary.",
);

const defaults = browserSessionHttpPolicy({ origin: "https://catalog.test/" });
assert(defaults.origin === "https://catalog.test", "The policy did not normalize its origin.");
assert(defaults.cookie?.name === "session", "The default logical cookie name changed.");
assert(defaults.cookie?.input === "session", "The protected input field changed.");
assert(
  JSON.stringify(defaults.cookie?.issue) ===
    JSON.stringify([
      { path: "/auth/register", value: "session", expires: "expiresAt" },
      { path: "/auth/sign-in", value: "session", expires: "expiresAt" },
      { path: "/auth/session/rotate", value: "session", expires: "expiresAt" },
    ]) &&
    JSON.stringify(defaults.cookie?.clear) ===
      JSON.stringify(["/auth/sign-out", "/auth/sign-out-all"]),
  "The policy issue or clear routes are desynchronized from the recipe.",
);
assert(
  defaults.publicErrors?.INVALID_CREDENTIALS === "UNAUTHORIZED" &&
    defaults.publicErrors?.UNKNOWN_SESSION === "UNAUTHORIZED" &&
    defaults.publicErrors?.IDENTIFIER_ALREADY_REGISTERED === "CONFLICT",
  "The default domain errors are not mapped conservatively.",
);

const custom = browserSessionHttpPolicy({
  origin: "https://api.catalog.test",
  basePath: "/api",
  publicErrors: { PROFILE_NOT_FOUND: "NOT_FOUND", APPLICATION_FAILURE: "FORBIDDEN" },
  cookie: {
    name: "browser_session",
    sameSite: "None",
    path: "/api",
    domain: "catalog.test",
    origins: ["https://app.catalog.test"],
  },
});
assert(
  custom.basePath === "/api" &&
    custom.cookie?.name === "browser_session" &&
    custom.cookie?.sameSite === "None" &&
    custom.cookie?.path === "/api" &&
    custom.cookie?.domain === "catalog.test" &&
    Array.isArray(custom.cookie?.origins) &&
    custom.cookie.origins[0] === "https://app.catalog.test",
  "Safe cookie customization was not preserved.",
);
assert(
  custom.cookie?.input === "session" &&
    custom.publicErrors?.PROFILE_NOT_FOUND === "NOT_FOUND" &&
    custom.publicErrors?.APPLICATION_FAILURE === "FORBIDDEN",
  "Customization replaced a fixed field or lost public errors.",
);

console.log("browser-session declarations and HTTP policy hold");
