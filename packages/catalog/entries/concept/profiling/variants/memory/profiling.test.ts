import {
  ProfilingConcept,
  DisplayNameRequired,
  ProfileAlreadyExists,
  ProfileNotFound,
} from "./profiling.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function expectRefusal(action: () => unknown, refusal: new () => Error, message: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof refusal) return;
    throw error;
  }
  throw new Error(message);
}

function stateOf(profiling: ProfilingConcept, profile: string, principal: string): string {
  return JSON.stringify({
    byProfile: profiling._get({ profile }),
    byPrincipal: profiling._forPrincipal({ principal }),
  });
}

const principal = "external:issuer/subject-7";
const originalName = "  Mina\t";
let generated = 0;
const profiling = new ProfilingConcept(() => `profile-${++generated}`);
const { profile } = profiling.create({ principal, displayName: originalName });
assert(profile === "profile-1", "The fresh profile identity was not returned.");

const byProfile = profiling._get({ profile });
assert(byProfile.length === 1, "Profile lookup did not return exactly one row.");
assert(byProfile[0]?.principal === principal, "Profile lookup lost the opaque principal.");
assert(byProfile[0]?.displayName === originalName, "Create changed the display-name bytes.");
const byPrincipal = profiling._forPrincipal({ principal });
assert(byPrincipal.length === 1, "Principal lookup did not return exactly one row.");
assert(byPrincipal[0]?.profile === profile, "Principal lookup returned the wrong profile.");
assert(byPrincipal[0]?.displayName === originalName, "Principal lookup changed the display name.");
assert(profiling._get({ profile: "missing" }).length === 0, "An unknown profile returned a row.");
assert(
  profiling._forPrincipal({ principal: "external:missing" }).length === 0,
  "An unknown principal returned a row.",
);

const createdState = stateOf(profiling, profile, principal);
expectRefusal(
  () => profiling.create({ principal, displayName: "Another Mina" }),
  ProfileAlreadyExists,
  "A second profile was created for one principal.",
);
assert(stateOf(profiling, profile, principal) === createdState, "Duplicate create changed state.");
const generatedAfterDuplicate = generated;
expectRefusal(
  () => profiling.create({ principal, displayName: "   " }),
  DisplayNameRequired,
  "Blank-name validation did not take precedence over duplicate principal detection.",
);
expectRefusal(
  () => profiling.create({ principal: "external:new", displayName: " \t\n" }),
  DisplayNameRequired,
  "Create accepted a trim-empty display name.",
);
assert(stateOf(profiling, profile, principal) === createdState, "Blank create changed state.");
assert(generated === generatedAfterDuplicate, "A blank-name refusal consumed an identity.");

const renamedName = "  Mina P.\t";
assert(
  profiling.rename({ profile, displayName: renamedName }).profile === profile,
  "Rename did not return the profile identity.",
);
assert(profiling._get({ profile })[0]?.displayName === renamedName, "Rename changed supplied bytes.");
assert(
  profiling._forPrincipal({ principal })[0]?.displayName === renamedName,
  "Principal lookup did not show the renamed profile.",
);

const renamedState = stateOf(profiling, profile, principal);
expectRefusal(
  () => profiling.rename({ profile, displayName: "\t " }),
  DisplayNameRequired,
  "Rename accepted a trim-empty display name.",
);
assert(stateOf(profiling, profile, principal) === renamedState, "Blank rename changed state.");
expectRefusal(
  () => profiling.rename({ profile: "missing", displayName: "   " }),
  ProfileNotFound,
  "Rename did not give not-found precedence over name validation.",
);
assert(stateOf(profiling, profile, principal) === renamedState, "Missing rename changed state.");

const colliding = new ProfilingConcept(() => "same-profile");
colliding.create({ principal: "external:first", displayName: "First" });
const collisionState = stateOf(colliding, "same-profile", "external:first");
try {
  colliding.create({ principal: "external:second", displayName: "Second" });
  throw new Error("A duplicate generated profile identity was accepted.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Generated profile identity already exists.") {
    throw error;
  }
}
assert(
  stateOf(colliding, "same-profile", "external:first") === collisionState &&
    colliding._forPrincipal({ principal: "external:second" }).length === 0,
  "A generated identity collision changed profile state.",
);

const invalidIdentity = new ProfilingConcept(() => "p".repeat(129));
try {
  invalidIdentity.create({ principal: "external:invalid", displayName: "Invalid" });
  throw new Error("An oversized generated profile identity was accepted.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated profile identity must be 1-128 characters."
  ) {
    throw error;
  }
}
assert(
  invalidIdentity._forPrincipal({ principal: "external:invalid" }).length === 0,
  "An invalid generated identity changed profile state.",
);

const invalidDuplicateIDs = ["valid-profile", "p".repeat(129)];
const invalidDuplicate = new ProfilingConcept(
  () => invalidDuplicateIDs.shift() ?? "unexpected",
);
invalidDuplicate.create({ principal: "external:duplicate", displayName: "First" });
try {
  invalidDuplicate.create({ principal: "external:duplicate", displayName: "Second" });
  throw new Error("Duplicate principal handling hid an invalid generated identity.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated profile identity must be 1-128 characters."
  ) {
    throw error;
  }
}

console.log("Profiling principle holds");
