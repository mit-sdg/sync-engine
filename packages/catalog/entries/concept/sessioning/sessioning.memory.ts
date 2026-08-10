import {
  isActive,
  secureSessionToken,
  SESSION_LIFETIME_MS,
  SESSION_TOKEN_ATTEMPTS,
  trustedTime,
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
  type SessionRecord,
  type SessioningDependencies,
} from "./sessioning.shared.ts";

export class SessioningMemoryConcept {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly clock: () => Date;
  private readonly freshSession: () => string;

  constructor({
    clock = () => new Date(),
    freshSession = secureSessionToken,
  }: SessioningDependencies = {}) {
    this.clock = clock;
    this.freshSession = freshSession;
  }

  start({ subject }: { subject: string }) {
    const now = trustedTime(this.clock);
    const session = this.#allocateSession();
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    this.sessions.set(session, { subject, expiresAt });
    return { session, expiresAt: new Date(expiresAt) };
  }

  current({ session }: { session: string }) {
    return { subject: this.#active(session, trustedTime(this.clock)).subject };
  }

  end({ session }: { session: string }) {
    this.#active(session, trustedTime(this.clock));
    this.sessions.delete(session);
    return { ended: true };
  }

  _active({ session }: { session: string }): Array<{ subject: string; expiresAt: Date }> {
    const found = this.sessions.get(session);
    if (found === undefined || !isActive(found, trustedTime(this.clock))) return [];
    return [{ subject: found.subject, expiresAt: new Date(found.expiresAt) }];
  }

  #allocateSession(): string {
    for (let attempt = 0; attempt < SESSION_TOKEN_ATTEMPTS; attempt += 1) {
      const session = this.freshSession();
      if (!this.sessions.has(session)) return session;
    }
    throw new Error("The session token source repeatedly returned an existing bearer value.");
  }

  #active(session: string, now: Date): SessionRecord {
    const found = this.sessions.get(session);
    if (found === undefined || !isActive(found, now)) {
      throw new UnknownSession(UNKNOWN_SESSION_DETAIL);
    }
    return found;
  }
}
