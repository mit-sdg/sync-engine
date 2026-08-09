import {
  ProfilingConcept,
  DisplayNameRequired,
  ProfileAlreadyExists,
  ProfileNotFound,
  type Profile,
  type ProfileRepository,
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

class MemoryProfileRepository implements ProfileRepository {
  readonly profiles = new Map<string, Profile>();
  readonly profilesByPrincipal = new Map<string, string>();
  createCalls = 0;
  principalReads = 0;

  create(record: Profile): "created" | "principal-exists" | "identity-exists" {
    this.createCalls += 1;
    if (this.profilesByPrincipal.has(record.principal)) return "principal-exists";
    if (this.profiles.has(record.profile)) return "identity-exists";
    this.profiles.set(record.profile, record);
    this.profilesByPrincipal.set(record.principal, record.profile);
    return "created";
  }

  rename(profile: string, displayName: string): "renamed" | "not-found" {
    const found = this.profiles.get(profile);
    if (found === undefined) return "not-found";
    this.profiles.set(profile, { ...found, displayName });
    return "renamed";
  }

  get(profile: string): Profile | undefined {
    return this.profiles.get(profile);
  }

  forPrincipal(principal: string): Profile | undefined {
    this.principalReads += 1;
    const profile = this.profilesByPrincipal.get(principal);
    return profile === undefined ? undefined : this.profiles.get(profile);
  }
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
const repository = new MemoryProfileRepository();
const profiling = new ProfilingConcept(repository, () => `profile-${++generated}`);
const { profile } = profiling.create({ principal, displayName: originalName });
assert(profile === "profile-1", "The repository variant did not return its fresh identity.");
assert(repository.createCalls === 1, "Create did not use the repository's atomic operation.");
assert(repository.principalReads === 0, "The adapter read before repository create.");

const byProfile = profiling._get({ profile });
assert(byProfile.length === 1, "Repository profile lookup did not return exactly one row.");
assert(byProfile[0]?.principal === principal, "Repository lookup lost the opaque principal.");
assert(byProfile[0]?.displayName === originalName, "Repository create changed display-name bytes.");
const byPrincipal = profiling._forPrincipal({ principal });
assert(byPrincipal.length === 1, "Repository principal lookup did not return exactly one row.");
assert(byPrincipal[0]?.profile === profile, "Repository principal lookup returned the wrong profile.");
assert(
  byPrincipal[0]?.displayName === originalName,
  "Repository principal lookup changed the display name.",
);
assert(profiling._get({ profile: "missing" }).length === 0, "An unknown profile returned a row.");
assert(
  profiling._forPrincipal({ principal: "external:missing" }).length === 0,
  "An unknown principal returned a row.",
);

const createdState = stateOf(profiling, profile, principal);
const principalReadsBeforeDuplicate = repository.principalReads;
expectRefusal(
  () => profiling.create({ principal, displayName: "Another Mina" }),
  ProfileAlreadyExists,
  "The atomic repository result did not refuse a duplicate profile.",
);
assert(repository.createCalls === 2, "Duplicate create bypassed the repository operation.");
assert(
  repository.principalReads === principalReadsBeforeDuplicate,
  "The adapter implemented uniqueness with a principal read before create.",
);
assert(stateOf(profiling, profile, principal) === createdState, "Duplicate create changed state.");
expectRefusal(
  () => profiling.create({ principal, displayName: "   " }),
  DisplayNameRequired,
  "Blank-name validation did not take precedence over duplicate principal detection.",
);
const callsBeforeBlankCreate = repository.createCalls;
const generatedBeforeBlankCreate = generated;
expectRefusal(
  () => profiling.create({ principal: "external:new", displayName: " \t\n" }),
  DisplayNameRequired,
  "Repository create accepted a trim-empty display name.",
);
assert(repository.createCalls === callsBeforeBlankCreate, "Blank create reached the repository.");
assert(generated === generatedBeforeBlankCreate, "Blank create consumed an identity.");
assert(stateOf(profiling, profile, principal) === createdState, "Blank create changed state.");

const renamedName = "  Mina P.\t";
assert(
  profiling.rename({ profile, displayName: renamedName }).profile === profile,
  "Repository rename did not return the profile identity.",
);
assert(profiling._get({ profile })[0]?.displayName === renamedName, "Rename changed supplied bytes.");
assert(
  profiling._forPrincipal({ principal })[0]?.displayName === renamedName,
  "Principal lookup did not show the repository rename.",
);

const renamedState = stateOf(profiling, profile, principal);
expectRefusal(
  () => profiling.rename({ profile, displayName: "\t " }),
  DisplayNameRequired,
  "Repository rename accepted a trim-empty display name.",
);
assert(stateOf(profiling, profile, principal) === renamedState, "Blank rename changed state.");
expectRefusal(
  () => profiling.rename({ profile: "missing", displayName: "   " }),
  ProfileNotFound,
  "Repository rename did not give not-found precedence over name validation.",
);
assert(stateOf(profiling, profile, principal) === renamedState, "Missing rename changed state.");

const staleRepository: ProfileRepository = {
  create: () => "principal-exists",
  rename: () => "not-found",
  get: () => ({ profile: "stale", principal: "external:stale", displayName: "Stale" }),
  forPrincipal: () => undefined,
};
expectRefusal(
  () => new ProfilingConcept(staleRepository).rename({ profile: "stale", displayName: "Current" }),
  ProfileNotFound,
  "The adapter did not honor an atomic rename not-found result.",
);

const collidingRepository = new MemoryProfileRepository();
const colliding = new ProfilingConcept(collidingRepository, () => "same-profile");
colliding.create({ principal: "external:first", displayName: "First" });
const collisionState = stateOf(colliding, "same-profile", "external:first");
try {
  colliding.create({ principal: "external:second", displayName: "Second" });
  throw new Error("The repository accepted a duplicate generated profile identity.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Generated profile identity already exists.") {
    throw error;
  }
}
assert(
  stateOf(colliding, "same-profile", "external:first") === collisionState &&
    colliding._forPrincipal({ principal: "external:second" }).length === 0,
  "A repository identity collision changed profile state.",
);

const overlappingRepository = new MemoryProfileRepository();
const overlapping = new ProfilingConcept(overlappingRepository, () => "same-profile");
overlapping.create({ principal: "external:same", displayName: "First" });
expectRefusal(
  () => overlapping.create({ principal: "external:same", displayName: "Second" }),
  ProfileAlreadyExists,
  "Identity collision took precedence over an existing principal.",
);

const invalidRepository = new MemoryProfileRepository();
const invalidIdentity = new ProfilingConcept(invalidRepository, () => "p".repeat(129));
try {
  invalidIdentity.create({ principal: "external:invalid", displayName: "Invalid" });
  throw new Error("An oversized generated profile identity reached the repository.");
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.message !== "Generated profile identity must be 1-128 characters."
  ) {
    throw error;
  }
}
assert(
  invalidRepository.createCalls === 0 &&
    invalidIdentity._forPrincipal({ principal: "external:invalid" }).length === 0,
  "An invalid generated identity changed repository profile state.",
);

const invalidDuplicateRepository = new MemoryProfileRepository();
const invalidDuplicateIDs = ["valid-profile", "p".repeat(129)];
const invalidDuplicate = new ProfilingConcept(
  invalidDuplicateRepository,
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

console.log("Profiling repository conformance holds");
