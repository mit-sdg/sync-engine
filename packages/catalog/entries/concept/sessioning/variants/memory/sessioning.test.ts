import { InvalidPrincipal, SessioningConcept, UnknownSession } from "./sessioning.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectError(action: () => unknown, expected: new () => Error, message: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof expected) return;
    throw error;
  }
  throw new Error(message);
}

let now = Date.parse("2030-01-01T00:00:00.000Z");
const credentials = ["session-a", "session-b", "session-c", "session-d"];
let generated = 0;
const sessioning = new SessioningConcept({
  clock: () => new Date(now),
  freshCredential: () => credentials[generated++] ?? "unexpected",
  lifetimeMs: 1_000,
});

const first = sessioning.start({ principal: "principal-a" });
const second = sessioning.start({ principal: "principal-a" });
assert(first.session === "session-a", "Start did not return the fresh session credential.");
assert(
  first.expiresAt.getTime() === now + 1_000,
  "Start did not return the configured absolute expiry.",
);
assert(
  sessioning.current({ session: first.session }).principal === "principal-a",
  "Current did not return the session principal.",
);

now += 100;
const rotated = sessioning.rotate({ session: first.session });
assert(
  rotated.replacement === "session-c" &&
    rotated.principal === "principal-a" &&
    rotated.expiresAt.getTime() === now + 1_000,
  "Rotate did not return the replacement binding and fresh expiry.",
);
expectError(
  () => sessioning.current({ session: first.session }),
  UnknownSession,
  "Rotation left the old session active.",
);
assert(
  sessioning.current({ session: rotated.replacement }).principal === "principal-a" &&
    sessioning.current({ session: second.session }).principal === "principal-a",
  "Rotation changed another session or lost the replacement.",
);

const ended = sessioning.endAll({ principal: "principal-a" });
assert(ended.endedCount === 2, "endAll did not report the number of active sessions removed.");
for (const session of [second.session, rotated.replacement]) {
  expectError(
    () => sessioning.current({ session }),
    UnknownSession,
    "endAll left an indexed session active.",
  );
}
assert(
  sessioning.endAll({ principal: "principal-a" }).endedCount === 0,
  "Repeated endAll did not report zero.",
);

const expiring = new SessioningConcept({
  clock: () => new Date(now),
  freshCredential: () => "expiring",
  lifetimeMs: 10,
});
const expiringSession = expiring.start({ principal: "principal-expiring" }).session;
now += 10;
expectError(
  () => expiring.current({ session: expiringSession }),
  UnknownSession,
  "An expired session remained current.",
);
expectError(
  () => expiring.end({ session: expiringSession }),
  UnknownSession,
  "Expiry cleanup did not make the session unknown.",
);
assert(
  expiring.endAll({ principal: "principal-expiring" }).endedCount === 0,
  "endAll counted an expired session as active.",
);

for (const unknown of ["missing", "", "s".repeat(129)]) {
  expectError(
    () => sessioning.current({ session: unknown }),
    UnknownSession,
    "Unknown and malformed sessions did not share one refusal.",
  );
}

let collisionCredential = "stable";
const collision = new SessioningConcept({
  clock: () => new Date("2030-01-01T00:00:00.000Z"),
  freshCredential: () => collisionCredential,
});
const stable = collision.start({ principal: "principal-stable" }).session;
try {
  collision.rotate({ session: stable });
  throw new Error("A colliding rotation credential was accepted.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Generated session credential already exists.") {
    throw error;
  }
}
assert(
  collision.current({ session: stable }).principal === "principal-stable",
  "A rotation collision invalidated the old session.",
);

collisionCredential = "";
try {
  collision.rotate({ session: stable });
  throw new Error("An invalid rotation credential was accepted.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated session credential must be 1-128 characters."
  ) {
    throw error;
  }
}
assert(
  collision.current({ session: stable }).principal === "principal-stable",
  "An invalid generated replacement invalidated the old session.",
);

let invalidGeneratorCalls = 0;
const invalidGenerator = new SessioningConcept({
  freshCredential: () => {
    invalidGeneratorCalls++;
    return "";
  },
});
expectError(
  () => invalidGenerator.start({ principal: "" }),
  InvalidPrincipal,
  "Principal validation did not precede credential generation.",
);
assert(invalidGeneratorCalls === 0, "An invalid principal consumed a session credential.");
try {
  invalidGenerator.start({ principal: "valid-principal" });
  throw new Error("An invalid generated session was accepted.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated session credential must be 1-128 characters."
  ) {
    throw error;
  }
}
assert(
  invalidGenerator.endAll({ principal: "valid-principal" }).endedCount === 0,
  "An invalid generated session changed owner state.",
);

expectError(
  () => sessioning.endAll({ principal: "p".repeat(129) }),
  InvalidPrincipal,
  "endAll accepted an oversized principal.",
);

const faultingClock = new SessioningConcept({ clock: () => new Date(Number.NaN) });
expectError(
  () => faultingClock.current({ session: "unknown" }),
  UnknownSession,
  "An unknown session consulted the host clock before using its generic refusal.",
);

const impossibleExpiry = new SessioningConcept({
  clock: () => new Date(8_640_000_000_000_000 - 1),
  freshCredential: () => "beyond-date-range",
  lifetimeMs: 2,
});
try {
  impossibleExpiry.start({ principal: "principal-date-limit" });
  throw new Error("A session with an unrepresentable expiry was accepted.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Session expiry is outside the safe Date range.") {
    throw error;
  }
}
assert(
  impossibleExpiry.endAll({ principal: "principal-date-limit" }).endedCount === 0,
  "An unrepresentable expiry changed owner state.",
);

const defaults = new SessioningConcept();
const defaultFirst = defaults.start({ principal: "principal-default" });
const defaultSecond = defaults.start({ principal: "principal-default" });
assert(
  defaultFirst.session !== defaultSecond.session &&
    defaultFirst.session.length <= 128 &&
    defaultFirst.expiresAt.getTime() - Date.now() > 29 * 60 * 1_000,
  "The default random credential or 30-minute lifetime is not usable.",
);

console.log("Sessioning principle holds");
