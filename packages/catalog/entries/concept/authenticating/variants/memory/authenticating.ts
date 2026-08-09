import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

export class IdentifierAlreadyRegistered extends Error {}
export class InvalidCredentials extends Error {}
export class InvalidIdentifier extends Error {}
export class InvalidSecret extends Error {}

export interface SecretCodec {
  digest(secret: string): string;
  verify(secret: string, digest: string): boolean;
}

export interface AuthenticatingOptions {
  codec?: SecretCodec;
  freshPrincipal?: () => string;
}

type Credential = { principal: string; secretDigest: string };

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SECRET = "catalog-dummy-secret";

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function validIdentifier(value: unknown): value is string {
  return boundedString(value, 1, 128) && value.trim() !== "";
}

function validSecret(value: unknown): value is string {
  return boundedString(value, 8, 1_024);
}

function requireIdentifier(value: unknown): asserts value is string {
  if (!validIdentifier(value)) throw new InvalidIdentifier();
}

function requireSecret(value: unknown): asserts value is string {
  if (!validSecret(value)) throw new InvalidSecret();
}

function requirePrincipal(value: unknown): asserts value is string {
  if (!boundedString(value, 1, 128)) {
    throw new Error("Generated principal identity must be 1-128 characters.");
  }
}

function requireDigest(value: unknown, secret: string): asserts value is string {
  if (!boundedString(value, 1, 4_096) || value === secret) {
    throw new Error("Secret codec must return a non-plaintext digest of 1-4096 characters.");
  }
}

/** Create the process-local default codec; applications can replace this seam. */
export function scryptSecretCodec(): SecretCodec {
  return {
    digest(secret) {
      const salt = randomBytes(16);
      const key = scryptSync(secret, salt, SCRYPT_KEY_BYTES, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELISM,
        maxmem: SCRYPT_MAX_MEMORY,
      });
      return [
        "scrypt",
        SCRYPT_COST,
        SCRYPT_BLOCK_SIZE,
        SCRYPT_PARALLELISM,
        salt.toString("base64url"),
        key.toString("base64url"),
      ].join("$");
    },
    verify(secret, digest) {
      const [scheme, cost, blockSize, parallelism, encodedSalt, encodedKey, extra] =
        digest.split("$");
      if (
        scheme !== "scrypt" ||
        cost !== String(SCRYPT_COST) ||
        blockSize !== String(SCRYPT_BLOCK_SIZE) ||
        parallelism !== String(SCRYPT_PARALLELISM) ||
        encodedSalt === undefined ||
        encodedKey === undefined ||
        extra !== undefined
      ) {
        return false;
      }
      const salt = Buffer.from(encodedSalt, "base64url");
      const expected = Buffer.from(encodedKey, "base64url");
      if (
        salt.length !== 16 ||
        expected.length !== SCRYPT_KEY_BYTES ||
        salt.toString("base64url") !== encodedSalt ||
        expected.toString("base64url") !== encodedKey
      ) {
        return false;
      }
      const actual = scryptSync(secret, salt, expected.length, {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELISM,
        maxmem: SCRYPT_MAX_MEMORY,
      });
      return timingSafeEqual(actual, expected);
    },
  };
}

/** Own exact identifier-to-principal credentials in process-local memory. */
export class AuthenticatingConcept {
  private readonly credentials = new Map<string, Credential>();
  private readonly principals = new Set<string>();
  private readonly codec: SecretCodec;
  private readonly freshPrincipal: () => string;
  private readonly dummyDigest: string;

  constructor(options: AuthenticatingOptions = {}) {
    this.codec = options.codec ?? scryptSecretCodec();
    this.freshPrincipal = options.freshPrincipal ?? randomUUID;
    this.dummyDigest = this.#digest(DUMMY_SECRET);
  }

  register({ identifier, secret }: { identifier: string; secret: string }) {
    requireIdentifier(identifier);
    requireSecret(secret);
    const existing = this.credentials.get(identifier);
    if (existing !== undefined) {
      if (!this.codec.verify(secret, existing.secretDigest)) {
        throw new IdentifierAlreadyRegistered();
      }
      return { principal: existing.principal };
    }

    const principal = this.freshPrincipal();
    requirePrincipal(principal);
    if (this.principals.has(principal)) {
      throw new Error("Generated principal identity already exists.");
    }
    const secretDigest = this.#digest(secret);
    this.credentials.set(identifier, { principal, secretDigest });
    this.principals.add(principal);
    return { principal };
  }

  authenticate({ identifier, secret }: { identifier: string; secret: string }) {
    return { principal: this.#authenticate(identifier, secret).principal };
  }

  changeSecret({
    identifier,
    currentSecret,
    newSecret,
  }: {
    identifier: string;
    currentSecret: string;
    newSecret: string;
  }) {
    requireSecret(newSecret);
    const credential = this.#authenticate(identifier, currentSecret);
    const secretDigest = this.#digest(newSecret);
    this.credentials.set(identifier, { principal: credential.principal, secretDigest });
    return { principal: credential.principal };
  }

  #authenticate(identifier: unknown, secret: unknown): Credential {
    const suppliedSecret = validSecret(secret) ? secret : DUMMY_SECRET;
    const credential = validIdentifier(identifier) ? this.credentials.get(identifier) : undefined;
    const digest = credential !== undefined && validSecret(secret) ? credential.secretDigest : this.dummyDigest;
    const verified = this.codec.verify(suppliedSecret, digest);
    if (credential === undefined || !validSecret(secret) || !verified) {
      throw new InvalidCredentials();
    }
    return credential;
  }

  #digest(secret: string): string {
    const digest = this.codec.digest(secret);
    requireDigest(digest, secret);
    return digest;
  }
}
