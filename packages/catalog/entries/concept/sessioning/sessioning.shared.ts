import { randomBytes } from "node:crypto";

export class UnknownSession extends Error {}

export interface SessionRecord {
  subject: string;
  expiresAt: Date;
}

export interface SessionDocument extends SessionRecord {
  sessionDigest: string;
}

export interface SessioningDependencies {
  clock?: () => Date;
  freshSession?: () => string;
}

export const SESSION_LIFETIME_MS = 30 * 60 * 1000;
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_ATTEMPTS = 32;
export const UNKNOWN_SESSION_DETAIL = "This session is not active.";

export function secureSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function trustedTime(clock: () => Date): Date {
  const milliseconds = clock().getTime();
  if (!Number.isFinite(milliseconds))
    throw new RangeError("The trusted clock returned an invalid Date.");
  return new Date(milliseconds);
}

export function isActive(record: SessionRecord, now: Date): boolean {
  return record.expiresAt.getTime() > now.getTime();
}
