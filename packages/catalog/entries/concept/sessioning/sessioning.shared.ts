import { randomBytes } from "node:crypto";

export class InvalidSessionLifetime extends Error {}
export class UnknownSession extends Error {}

export interface SessionRecord {
  subject: string;
  expiresAt: Date;
}

export interface SessionDocument extends SessionRecord {
  sessionDigest: string;
}

export interface SessioningDependencies {
  freshSession?: () => string;
}

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_ATTEMPTS = 32;
export const INVALID_SESSION_LIFETIME_DETAIL =
  "A session lifetime must be a positive number of milliseconds.";
export const UNKNOWN_SESSION_DETAIL = "This session is not active.";

export function secureSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function dateTime(value: Date): Date {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) throw new RangeError("The supplied instant is invalid.");
  return new Date(milliseconds);
}

export function expiration(now: Date, lifetime: number): Date {
  const milliseconds = now.getTime() + lifetime;
  if (!Number.isFinite(lifetime) || lifetime <= 0 || !Number.isFinite(milliseconds)) {
    throw new InvalidSessionLifetime(INVALID_SESSION_LIFETIME_DETAIL);
  }
  const expiresAt = new Date(milliseconds);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new InvalidSessionLifetime(INVALID_SESSION_LIFETIME_DETAIL);
  }
  return expiresAt;
}

export function isActive(record: SessionRecord, now: Date): boolean {
  return record.expiresAt.getTime() > now.getTime();
}
