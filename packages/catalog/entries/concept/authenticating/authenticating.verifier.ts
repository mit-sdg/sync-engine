import { timingSafeEqual } from "node:crypto";
import { hash, verify, type Options } from "@node-rs/argon2";
import type { PasswordCredential, PasswordVerifierStrategy } from "./authenticating.shared.ts";

export const CURRENT_ARGON2ID_POLICY = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  saltBytes: 16,
});

const DUMMY_PASSWORD_VERIFIER =
  "$argon2id$v=19$m=19456,t=2,p=1$paWlpaWlpaWlpaWlpaWlpQ$Qxghaea65x6Wttmctu4VDirG0PGP+PqWi93OSda9LxI";

interface ParsedVerifier {
  version: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  salt: Buffer;
  output: Buffer;
}

function saltBytes(salt: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(salt))
    throw new Error("A password salt must use base64url encoding.");
  const decoded = Buffer.from(salt, "base64url");
  if (decoded.length < CURRENT_ARGON2ID_POLICY.saltBytes) {
    throw new Error("A password salt must contain at least 16 bytes.");
  }
  return decoded;
}

function parseVerifier(passwordVerifier: string): ParsedVerifier | undefined {
  const match =
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      passwordVerifier,
    );
  if (match === null) return undefined;
  const [
    ,
    encodedVersion,
    encodedMemory,
    encodedTime,
    encodedParallelism,
    encodedSalt,
    encodedOutput,
  ] = match;
  const version = Number(encodedVersion);
  const memoryCost = Number(encodedMemory);
  const timeCost = Number(encodedTime);
  const parallelism = Number(encodedParallelism);
  const salt = Buffer.from(encodedSalt, "base64");
  const output = Buffer.from(encodedOutput, "base64");
  if (
    (version !== 16 && version !== 19) ||
    !Number.isSafeInteger(memoryCost) ||
    memoryCost < 8 * parallelism ||
    memoryCost > 1024 * 1024 ||
    !Number.isSafeInteger(timeCost) ||
    timeCost < 1 ||
    timeCost > 100 ||
    !Number.isSafeInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > 255 ||
    salt.length < 8 ||
    output.length < 4
  ) {
    return undefined;
  }
  return { version, memoryCost, timeCost, parallelism, salt, output };
}

function currentEnough(passwordVerifier: string): boolean {
  const parsed = parseVerifier(passwordVerifier);
  return (
    parsed !== undefined &&
    parsed.version === 19 &&
    parsed.memoryCost >= CURRENT_ARGON2ID_POLICY.memoryCost &&
    parsed.timeCost >= CURRENT_ARGON2ID_POLICY.timeCost &&
    parsed.parallelism >= CURRENT_ARGON2ID_POLICY.parallelism &&
    parsed.salt.length >= CURRENT_ARGON2ID_POLICY.saltBytes &&
    parsed.output.length >= CURRENT_ARGON2ID_POLICY.outputLen
  );
}

if (!currentEnough(DUMMY_PASSWORD_VERIFIER)) {
  throw new Error("The dummy password verifier does not meet the current Argon2id policy.");
}

function matchingSalt(credential: PasswordCredential, parsed: ParsedVerifier): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(credential.salt)) return false;
  const stored = Buffer.from(credential.salt, "base64url");
  return stored.length === parsed.salt.length && timingSafeEqual(stored, parsed.salt);
}

async function verifyOrDummy(
  password: string,
  credential: PasswordCredential | undefined,
): Promise<boolean> {
  if (credential === undefined) {
    await verify(DUMMY_PASSWORD_VERIFIER, password);
    return false;
  }
  const parsed = parseVerifier(credential.passwordVerifier);
  if (parsed === undefined || !matchingSalt(credential, parsed)) {
    await verify(DUMMY_PASSWORD_VERIFIER, password);
    return false;
  }
  return verify(credential.passwordVerifier, password);
}

/**
 * The shipped strategy writes self-describing Argon2id PHC strings. Its policy is
 * implementation configuration, not part of the Authenticating specification.
 */
export const argon2idPasswordVerifier: PasswordVerifierStrategy = {
  async create({ password, salt }) {
    return hash(password, {
      algorithm: 2 as NonNullable<Options["algorithm"]>,
      version: 1 as NonNullable<Options["version"]>,
      memoryCost: CURRENT_ARGON2ID_POLICY.memoryCost,
      timeCost: CURRENT_ARGON2ID_POLICY.timeCost,
      parallelism: CURRENT_ARGON2ID_POLICY.parallelism,
      outputLen: CURRENT_ARGON2ID_POLICY.outputLen,
      salt: saltBytes(salt),
    });
  },

  async verify({ password, credential }) {
    return verifyOrDummy(password, credential);
  },

  needsUpgrade(passwordVerifier) {
    return !currentEnough(passwordVerifier);
  },
};
