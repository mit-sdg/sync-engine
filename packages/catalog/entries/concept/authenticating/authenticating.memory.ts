import {
  type AccountRecord,
  type AuthenticatingDependencies,
  InvalidCredentials,
  INVALID_CREDENTIALS_DETAIL,
  InvalidUsername,
  INVALID_USERNAME_DETAIL,
  passwordMatches,
  securePasswordSalt,
  type PasswordCredential,
  type PasswordVerifierStrategy,
  UsernameTaken,
  USERNAME_TAKEN_DETAIL,
  validPassword,
  validUsername,
  WeakPassword,
  WEAK_PASSWORD_DETAIL,
} from "./authenticating.shared.ts";
import { argon2idPasswordVerifier } from "./authenticating.verifier.ts";

export class AuthenticatingMemoryConcept {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly passwordVerifier: PasswordVerifierStrategy;
  private readonly freshSalt: () => string;

  constructor({
    passwordVerifier = argon2idPasswordVerifier,
    freshSalt = securePasswordSalt,
  }: AuthenticatingDependencies = {}) {
    this.passwordVerifier = passwordVerifier;
    this.freshSalt = freshSalt;
  }

  async register({ username, password }: { username: string; password: string }) {
    if (!validUsername(username)) throw new InvalidUsername(INVALID_USERNAME_DETAIL);
    if (!validPassword(password)) throw new WeakPassword(WEAK_PASSWORD_DETAIL);
    if (this.accounts.has(username)) throw new UsernameTaken(USERNAME_TAKEN_DETAIL);

    const credential = await this.#createCredential(password);
    if (this.accounts.has(username)) throw new UsernameTaken(USERNAME_TAKEN_DETAIL);
    this.accounts.set(username, { username, ...credential });
    return { username };
  }

  async authenticate({ username, password }: { username: string; password: string }) {
    const account = this.accounts.get(username);
    const matches = await passwordMatches(this.passwordVerifier, account, password);
    if (account === undefined || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    await this.#upgrade(account, password);
    return { username };
  }

  async changePassword({
    username,
    currentPassword,
    newPassword,
  }: {
    username: string;
    currentPassword: string;
    newPassword: string;
  }) {
    if (!validPassword(newPassword)) throw new WeakPassword(WEAK_PASSWORD_DETAIL);
    const account = this.accounts.get(username);
    const matches = await passwordMatches(this.passwordVerifier, account, currentPassword);
    if (account === undefined || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);

    const credential = await this.#createCredential(newPassword);
    if (this.accounts.get(username) !== account) {
      throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    }
    this.accounts.set(username, { username, ...credential });
    return { username };
  }

  async unregister({ username, password }: { username: string; password: string }) {
    const account = this.accounts.get(username);
    const matches = await passwordMatches(this.passwordVerifier, account, password);
    if (account === undefined || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    if (this.accounts.get(username) !== account) {
      throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    }
    this.accounts.delete(username);
    return { username };
  }

  _registered({ username }: { username: string }): { registered: boolean } {
    return { registered: this.accounts.has(username) };
  }

  async #createCredential(password: string): Promise<PasswordCredential> {
    const salt = this.freshSalt();
    const passwordVerifier = await this.passwordVerifier.create({ password, salt });
    return { salt, passwordVerifier };
  }

  async #upgrade(account: AccountRecord, password: string): Promise<void> {
    if (!this.passwordVerifier.needsUpgrade(account.passwordVerifier)) return;
    const credential = await this.#createCredential(password);
    if (this.accounts.get(account.username) === account) {
      this.accounts.set(account.username, { username: account.username, ...credential });
    }
  }
}
