import { pbkdf2Sync, timingSafeEqual } from "node:crypto";

export class InvalidUsername extends Error {}
export class WeakPassword extends Error {}
export class UsernameTaken extends Error {}
export class InvalidCredentials extends Error {}

type Account = { salt: string; verifier: Buffer };

const USERNAME = /^[A-Za-z0-9_-]{3,32}$/;

function verifier(password: string, salt: string): Buffer {
  return pbkdf2Sync(password, salt, 10_000, 32, "sha256");
}

export class AuthenticatingConcept {
  private readonly accounts = new Map<string, Account>();

  constructor(private readonly freshSalt: () => string = () => crypto.randomUUID()) {}

  register({ username, password }: { username: string; password: string }) {
    if (!USERNAME.test(username)) {
      throw new InvalidUsername(
        "A username must contain 3 to 32 letters, numbers, underscores, or hyphens.",
      );
    }
    if (password.length < 8 || password.length > 128) {
      throw new WeakPassword("A password must contain 8 to 128 characters.");
    }
    if (this.accounts.has(username)) {
      throw new UsernameTaken("That username is already registered.");
    }
    const salt = this.freshSalt();
    this.accounts.set(username, { salt, verifier: verifier(password, salt) });
    return { account: username };
  }

  authenticate({ username, password }: { username: string; password: string }) {
    const account = this.accounts.get(username);
    const supplied = account === undefined ? undefined : verifier(password, account.salt);
    if (
      account === undefined ||
      supplied === undefined ||
      !timingSafeEqual(account.verifier, supplied)
    ) {
      throw new InvalidCredentials("The username or password is incorrect.");
    }
    return { account: username };
  }

  _registered({ username }: { username: string }): { registered: boolean } {
    return { registered: this.accounts.has(username) };
  }
}
