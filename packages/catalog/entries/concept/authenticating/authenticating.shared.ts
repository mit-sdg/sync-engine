import { randomBytes } from "node:crypto";

export class InvalidUsername extends Error {}
export class WeakPassword extends Error {}
export class UsernameTaken extends Error {}
export class InvalidCredentials extends Error {}

export interface PasswordCredential {
  salt: string;
  passwordVerifier: string;
}

export interface AccountRecord extends PasswordCredential {
  username: string;
}

export interface PasswordVerifierStrategy {
  create(input: { password: string; salt: string }): Promise<string>;
  verify(input: { password: string; credential: PasswordCredential | undefined }): Promise<boolean>;
  needsUpgrade(passwordVerifier: string): boolean;
}

export interface AuthenticatingDependencies {
  passwordVerifier?: PasswordVerifierStrategy;
  freshSalt?: () => string;
}

export const PASSWORD_SALT_BYTES = 16;
export const INVALID_USERNAME_DETAIL =
  "A username must contain 3 to 32 letters, numbers, underscores, or hyphens.";
export const WEAK_PASSWORD_DETAIL = "A password must contain 8 to 128 characters.";
export const USERNAME_TAKEN_DETAIL = "That username is already registered.";
export const INVALID_CREDENTIALS_DETAIL = "The username or password is incorrect.";

const USERNAME = /^[A-Za-z0-9_-]{3,32}$/;

export function validUsername(username: string): boolean {
  return USERNAME.test(username);
}

export function validPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export function securePasswordSalt(): string {
  return randomBytes(PASSWORD_SALT_BYTES).toString("base64url");
}

export async function passwordMatches(
  strategy: PasswordVerifierStrategy,
  account: AccountRecord | undefined,
  password: string,
): Promise<boolean> {
  const admissible = validPassword(password);
  const candidate = admissible ? account : undefined;
  const boundedPassword = password.length <= 128 ? password : password.slice(0, 128);
  const verified = await strategy.verify({ password: boundedPassword, credential: candidate });
  return account !== undefined && admissible && verified;
}
