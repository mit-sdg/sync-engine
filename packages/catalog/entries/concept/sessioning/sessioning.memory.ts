import {
  dateTime,
  expiration,
  isActive,
  secureSessionToken,
  SESSION_TOKEN_ATTEMPTS,
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
  type SessionRecord,
  type SessioningDependencies,
} from "./sessioning.shared.ts";

export class SessioningMemoryConcept {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly freshSession: () => string;

  constructor({ freshSession = secureSessionToken }: SessioningDependencies = {}) {
    this.freshSession = freshSession;
  }

  start({ subject, lifetime, now }: { subject: string; lifetime: number; now: Date }) {
    const expiresAt = expiration(dateTime(now), lifetime);
    const session = this.#allocateSession();
    this.sessions.set(session, { subject, expiresAt });
    return { session, expiresAt: new Date(expiresAt) };
  }

  current({ session, now }: { session: string; now: Date }) {
    return { subject: this.#active(session, dateTime(now)).subject };
  }

  end({ session, now }: { session: string; now: Date }) {
    this.#active(session, dateTime(now));
    this.sessions.delete(session);
    return { ended: true };
  }

  _active({
    session,
    now,
  }: {
    session: string;
    now: Date;
  }): Array<{ subject: string; expiresAt: Date }> {
    const found = this.sessions.get(session);
    if (found === undefined || !isActive(found, dateTime(now))) return [];
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
