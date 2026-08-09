import { randomBytes } from "node:crypto";

export class InvalidPrincipal extends Error {}
export class UnknownSession extends Error {}

export interface SessioningOptions {
  clock?: () => Date;
  freshCredential?: () => string;
  lifetimeMs?: number;
}

type Session = { principal: string; expiresAt: number };

const DEFAULT_LIFETIME_MS = 30 * 60 * 1_000;
const MAXIMUM_LIFETIME_MS = 24 * 60 * 60 * 1_000;

function boundedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 128;
}

function requirePrincipal(value: unknown): asserts value is string {
  if (!boundedIdentity(value)) throw new InvalidPrincipal();
}

function generatedCredential(freshCredential: () => string): string {
  const session = freshCredential();
  if (!boundedIdentity(session)) {
    throw new Error("Generated session credential must be 1-128 characters.");
  }
  return session;
}

/** Own principal sessions and their revocation index in process-local memory. */
export class SessioningConcept {
  private readonly sessions = new Map<string, Session>();
  private readonly sessionsByPrincipal = new Map<string, Set<string>>();
  private readonly clock: () => Date;
  private readonly freshCredential: () => string;
  private readonly lifetimeMs: number;

  constructor(options: SessioningOptions = {}) {
    const lifetimeMs = options.lifetimeMs ?? DEFAULT_LIFETIME_MS;
    if (
      !Number.isFinite(lifetimeMs) ||
      !Number.isInteger(lifetimeMs) ||
      lifetimeMs < 1 ||
      lifetimeMs > MAXIMUM_LIFETIME_MS
    ) {
      throw new Error("Session lifetime must be an integer from 1 to 86400000 milliseconds.");
    }
    this.clock = options.clock ?? (() => new Date());
    this.freshCredential =
      options.freshCredential ?? (() => randomBytes(32).toString("base64url"));
    this.lifetimeMs = lifetimeMs;
  }

  start({ principal }: { principal: string }) {
    requirePrincipal(principal);
    const now = this.#now();
    const session = generatedCredential(this.freshCredential);
    if (this.sessions.has(session)) throw new Error("Generated session credential already exists.");
    const expiresAt = this.#expiry(now);
    this.#insert(session, { principal, expiresAt });
    return { session, expiresAt: new Date(expiresAt) };
  }

  current({ session }: { session: string }) {
    const { found } = this.#active(session);
    return { principal: found.principal, expiresAt: new Date(found.expiresAt) };
  }

  rotate({ session }: { session: string }) {
    const { found, now } = this.#active(session);
    const replacement = generatedCredential(this.freshCredential);
    if (this.sessions.has(replacement)) {
      throw new Error("Generated session credential already exists.");
    }
    const expiresAt = this.#expiry(now);

    this.#remove(session, found);
    this.#insert(replacement, { principal: found.principal, expiresAt });
    return { replacement, expiresAt: new Date(expiresAt), principal: found.principal };
  }

  end({ session }: { session: string }) {
    const { found } = this.#active(session);
    this.#remove(session, found);
    return { ended: true };
  }

  endAll({ principal }: { principal: string }) {
    requirePrincipal(principal);
    const now = this.#now();
    const indexed = [...(this.sessionsByPrincipal.get(principal) ?? [])];
    let endedCount = 0;
    for (const session of indexed) {
      const found = this.sessions.get(session);
      if (found === undefined) continue;
      this.#remove(session, found);
      if (found.expiresAt > now) endedCount++;
    }
    return { endedCount };
  }

  #now(): number {
    const value = this.clock();
    const now = value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isFinite(now)) throw new Error("Session clock must return a valid Date.");
    return now;
  }

  #expiry(now: number): number {
    const expiresAt = now + this.lifetimeMs;
    if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(new Date(expiresAt).getTime())) {
      throw new Error("Session expiry is outside the safe Date range.");
    }
    return expiresAt;
  }

  #active(session: unknown): { found: Session; now: number } {
    if (!boundedIdentity(session)) throw new UnknownSession();
    const found = this.sessions.get(session);
    if (found === undefined) throw new UnknownSession();
    const now = this.#now();
    if (found.expiresAt <= now) {
      this.#remove(session, found);
      throw new UnknownSession();
    }
    return { found, now };
  }

  #insert(session: string, found: Session): void {
    this.sessions.set(session, found);
    const indexed = this.sessionsByPrincipal.get(found.principal) ?? new Set<string>();
    indexed.add(session);
    this.sessionsByPrincipal.set(found.principal, indexed);
  }

  #remove(session: string, found: Session): void {
    this.sessions.delete(session);
    const indexed = this.sessionsByPrincipal.get(found.principal);
    indexed?.delete(session);
    if (indexed?.size === 0) this.sessionsByPrincipal.delete(found.principal);
  }
}
