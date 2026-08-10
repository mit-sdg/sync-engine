import type { Collection, Db, Filter } from "mongodb";
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

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureAuthenticatingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = db
      .collection<AccountRecord>("authenticating_accounts")
      .createIndex({ username: 1 }, { name: "account_username_unique", unique: true })
      .then(() => undefined);
    indexes.set(db, ready);
    void ready.catch(() => indexes.delete(db));
  }
  return ready;
}

export class AuthenticatingMongoConcept {
  private readonly accounts: Collection<AccountRecord>;
  private readonly passwordVerifier: PasswordVerifierStrategy;
  private readonly freshSalt: () => string;

  constructor(
    private readonly db: Db,
    {
      passwordVerifier = argon2idPasswordVerifier,
      freshSalt = securePasswordSalt,
    }: AuthenticatingDependencies = {},
  ) {
    this.accounts = db.collection("authenticating_accounts");
    this.passwordVerifier = passwordVerifier;
    this.freshSalt = freshSalt;
  }

  async register({ username, password }: { username: string; password: string }) {
    if (!validUsername(username)) throw new InvalidUsername(INVALID_USERNAME_DETAIL);
    if (!validPassword(password)) throw new WeakPassword(WEAK_PASSWORD_DETAIL);
    await ensureAuthenticatingIndexes(this.db);
    const credential = await this.#createCredential(password);
    try {
      await this.accounts.insertOne({ username, ...credential });
    } catch (error) {
      if (duplicate(error)) throw new UsernameTaken(USERNAME_TAKEN_DETAIL);
      throw error;
    }
    return { username };
  }

  async authenticate({ username, password }: { username: string; password: string }) {
    const account = await this.accounts.findOne({ username }, { projection: { _id: 0 } });
    const matches = await passwordMatches(this.passwordVerifier, account ?? undefined, password);
    if (account === null || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
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
    const account = await this.accounts.findOne({ username }, { projection: { _id: 0 } });
    const matches = await passwordMatches(
      this.passwordVerifier,
      account ?? undefined,
      currentPassword,
    );
    if (account === null || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);

    const credential = await this.#createCredential(newPassword);
    const result = await this.accounts.updateOne(this.#credentialFilter(account), {
      $set: credential,
    });
    if (result.modifiedCount !== 1) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    return { username };
  }

  async unregister({ username, password }: { username: string; password: string }) {
    const account = await this.accounts.findOne({ username }, { projection: { _id: 0 } });
    const matches = await passwordMatches(this.passwordVerifier, account ?? undefined, password);
    if (account === null || !matches) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    const removed = await this.accounts.findOneAndDelete(this.#credentialFilter(account));
    if (removed === null) throw new InvalidCredentials(INVALID_CREDENTIALS_DETAIL);
    return { username };
  }

  async _registered({ username }: { username: string }): Promise<{ registered: boolean }> {
    return {
      registered: (await this.accounts.countDocuments({ username }, { limit: 1 })) > 0,
    };
  }

  async #createCredential(password: string): Promise<PasswordCredential> {
    const salt = this.freshSalt();
    const passwordVerifier = await this.passwordVerifier.create({ password, salt });
    return { salt, passwordVerifier };
  }

  #credentialFilter(account: AccountRecord): Filter<AccountRecord> {
    return {
      username: account.username,
      salt: account.salt,
      passwordVerifier: account.passwordVerifier,
    };
  }

  async #upgrade(account: AccountRecord, password: string): Promise<void> {
    if (!this.passwordVerifier.needsUpgrade(account.passwordVerifier)) return;
    const credential = await this.#createCredential(password);
    await this.accounts.updateOne(this.#credentialFilter(account), { $set: credential });
  }
}
