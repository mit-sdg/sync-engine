import { createHash, timingSafeEqual } from "node:crypto";
import type { PasswordCredential, PasswordVerifierStrategy } from "./authenticating.shared.ts";

function digest(password: string, salt: string): Buffer {
  return createHash("sha256").update(salt).update("\0").update(password).digest();
}

export class CountdownLatch {
  readonly reached: Promise<void>;
  #remaining: number;
  #resolve = () => {};

  constructor(count: number, label = `${count} test-latch arrivals`, timeoutMs = 10_000) {
    this.#remaining = count;
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.reached = new Promise<void>((resolve, reject) => {
      this.#resolve = () => {
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${label}.`));
      }, timeoutMs);
    });
    if (count === 0) this.#resolve();
  }

  arrive(): void {
    if (this.#remaining === 0) return;
    this.#remaining -= 1;
    if (this.#remaining === 0) this.#resolve();
  }
}

export class DeterministicPasswordVerifier implements PasswordVerifierStrategy {
  profile = "test-v1";
  creationGate: Promise<void> | undefined;
  creationStarted: (() => void) | undefined;
  verificationGate: Promise<void> | undefined;
  verificationStarted: (() => void) | undefined;
  readonly verificationKinds: string[] = [];
  readonly createdSalts: string[] = [];

  async create({ password, salt }: { password: string; salt: string }): Promise<string> {
    this.createdSalts.push(salt);
    this.creationStarted?.();
    await this.creationGate;
    return `${this.profile}.${salt}.${digest(password, salt).toString("base64url")}`;
  }

  async verify({
    password,
    credential,
  }: {
    password: string;
    credential: PasswordCredential | undefined;
  }): Promise<boolean> {
    this.verificationKinds.push(credential === undefined ? "dummy" : "account");
    this.verificationStarted?.();
    await this.verificationGate;
    const checked = credential ?? {
      salt: "dummy-salt",
      passwordVerifier: `dummy.dummy-salt.${digest("dummy-password", "dummy-salt").toString("base64url")}`,
    };
    const parts = checked.passwordVerifier.split(".");
    const encoded = parts.at(-1);
    if (encoded === undefined) return false;
    const expected = Buffer.from(encoded, "base64url");
    const supplied = digest(password, checked.salt);
    const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    return credential !== undefined && matches;
  }

  needsUpgrade(passwordVerifier: string): boolean {
    return !passwordVerifier.startsWith(`${this.profile}.`);
  }
}

export function saltSequence(values: string[]): () => string {
  return () => values.shift() ?? "unexpected-salt";
}
