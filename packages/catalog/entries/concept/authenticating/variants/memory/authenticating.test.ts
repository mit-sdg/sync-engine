import {
  AuthenticatingConcept,
  IdentifierAlreadyRegistered,
  InvalidCredentials,
  InvalidIdentifier,
  InvalidSecret,
  scryptSecretCodec,
  type SecretCodec,
} from "./authenticating.ts";

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

class RecordingCodec implements SecretCodec {
  readonly digests = new Map<string, string>();
  readonly verifications: Array<{ secret: string; digest: string }> = [];
  digestCalls = 0;
  failNextDigest = false;

  digest(secret: string): string {
    if (this.failNextDigest) {
      this.failNextDigest = false;
      throw new Error("injected codec failure");
    }
    const digest = `test-digest-${++this.digestCalls}`;
    this.digests.set(digest, secret);
    return digest;
  }

  verify(secret: string, digest: string): boolean {
    this.verifications.push({ secret, digest });
    return this.digests.get(digest) === secret;
  }
}

const codec = new RecordingCodec();
let generated = 0;
const authenticating = new AuthenticatingConcept({
  codec,
  freshPrincipal: () => `principal-${++generated}`,
});
const identifier = "  Mina/Primary  ";
const originalSecret = "correct horse battery staple";
const { principal } = authenticating.register({ identifier, secret: originalSecret });
assert(principal === "principal-1", "Registration did not return its generated principal.");
assert(
  authenticating.authenticate({ identifier, secret: originalSecret }).principal === principal,
  "The exact identifier and secret did not authenticate.",
);
expectError(
  () => authenticating.authenticate({ identifier: identifier.trim(), secret: originalSecret }),
  InvalidCredentials,
  "Authentication normalized an identifier.",
);

const stateBeforeDuplicate = { generated, digestCalls: codec.digestCalls };
assert(
  authenticating.register({ identifier, secret: originalSecret }).principal === principal,
  "Repeated registration with the same credential did not return its principal.",
);
assert(
  generated === stateBeforeDuplicate.generated && codec.digestCalls === stateBeforeDuplicate.digestCalls,
  "Repeated registration consumed a principal or changed a digest.",
);
expectError(
  () => authenticating.register({ identifier, secret: "another valid secret" }),
  IdentifierAlreadyRegistered,
  "Registration replaced an existing credential with a different secret.",
);
assert(
  authenticating.authenticate({ identifier, secret: originalSecret }).principal === principal,
  "Repeated registration changed the existing credential.",
);

expectError(
  () => authenticating.register({ identifier: " ", secret: "short" }),
  InvalidIdentifier,
  "Identifier validation did not take precedence.",
);
expectError(
  () => authenticating.register({ identifier, secret: "short" }),
  InvalidSecret,
  "Secret validation did not precede duplicate detection.",
);
assert(generated === 1, "Malformed registration consumed a principal.");

const dummyDigest = [...codec.digests.keys()][0];
codec.verifications.length = 0;
for (const input of [
  { identifier: "unknown", secret: originalSecret },
  { identifier, secret: "wrong but bounded" },
  { identifier, secret: "x" },
  { identifier: "", secret: originalSecret },
]) {
  expectError(
    () => authenticating.authenticate(input),
    InvalidCredentials,
    "A failed authentication did not use the generic refusal.",
  );
}
assert(
  codec.verifications[0]?.digest === dummyDigest &&
    codec.verifications[2]?.digest === dummyDigest &&
    codec.verifications[3]?.digest === dummyDigest,
  "Unknown or malformed credentials did not use the dummy verification digest.",
);

expectError(
  () =>
    authenticating.changeSecret({
      identifier,
      currentSecret: "wrong but bounded",
      newSecret: "replacement secret",
    }),
  InvalidCredentials,
  "A wrong current secret changed the credential.",
);
assert(
  authenticating.authenticate({ identifier, secret: originalSecret }).principal === principal,
  "A refused secret change damaged the old credential.",
);
codec.failNextDigest = true;
try {
  authenticating.changeSecret({
    identifier,
    currentSecret: originalSecret,
    newSecret: "codec failure replacement",
  });
  throw new Error("A codec failure was hidden.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "injected codec failure") throw error;
}
assert(
  authenticating.authenticate({ identifier, secret: originalSecret }).principal === principal,
  "A codec failure replaced the existing digest.",
);
expectError(
  () =>
    authenticating.changeSecret({
      identifier: "missing",
      currentSecret: "wrong but bounded",
      newSecret: "tiny",
    }),
  InvalidSecret,
  "New-secret validation did not take precedence.",
);

const replacementSecret = "replacement secret";
assert(
  authenticating.changeSecret({ identifier, currentSecret: originalSecret, newSecret: replacementSecret })
    .principal === principal,
  "Secret change returned the wrong principal.",
);
expectError(
  () => authenticating.authenticate({ identifier, secret: originalSecret }),
  InvalidCredentials,
  "The old secret remained valid after replacement.",
);
assert(
  authenticating.authenticate({ identifier, secret: replacementSecret }).principal === principal,
  "The replacement secret did not authenticate.",
);

const collidingCodec = new RecordingCodec();
const colliding = new AuthenticatingConcept({ codec: collidingCodec, freshPrincipal: () => "same" });
colliding.register({ identifier: "first", secret: "first secret" });
const digestCallsBeforeCollision = collidingCodec.digestCalls;
try {
  colliding.register({ identifier: "second", secret: "second secret" });
  throw new Error("A generated principal collision was accepted.");
} catch (error) {
  if (!(error instanceof Error) || error.message !== "Generated principal identity already exists.") {
    throw error;
  }
}
assert(
  collidingCodec.digestCalls === digestCallsBeforeCollision,
  "A principal collision digested or stored the second secret.",
);
expectError(
  () => colliding.authenticate({ identifier: "second", secret: "second secret" }),
  InvalidCredentials,
  "A principal collision created a credential.",
);

for (const generatedPrincipal of ["", "p".repeat(129)]) {
  const invalid = new AuthenticatingConcept({
    codec: new RecordingCodec(),
    freshPrincipal: () => generatedPrincipal,
  });
  try {
    invalid.register({ identifier: "invalid-generator", secret: "valid secret" });
    throw new Error("An invalid generated principal was accepted.");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Generated principal identity must be 1-128 characters."
    ) {
      throw error;
    }
  }
  expectError(
    () => invalid.authenticate({ identifier: "invalid-generator", secret: "valid secret" }),
    InvalidCredentials,
    "An invalid generated principal changed state.",
  );
}

const defaultCodec = scryptSecretCodec();
const encoded = defaultCodec.digest("default codec secret");
assert(encoded !== "default codec secret", "The default codec retained plaintext as its digest.");
assert(defaultCodec.verify("default codec secret", encoded), "The default scrypt codec rejected a match.");
assert(!defaultCodec.verify("different secret", encoded), "The default scrypt codec accepted a mismatch.");

console.log("Authenticating principle holds");
