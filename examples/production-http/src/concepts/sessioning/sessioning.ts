export class UnknownSession extends Error {}

type Session = { user: string; expiresAt: number };

const SESSION_LIFETIME_MS = 30 * 60 * 1000;

function activeSession(sessions: Map<string, Session>, session: string, now: number): Session {
  const found = sessions.get(session);
  if (found === undefined) throw new UnknownSession("This session is not active.");
  if (found.expiresAt <= now) {
    sessions.delete(session);
    throw new UnknownSession("This session is not active.");
  }
  return found;
}

export class SessioningConcept {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  start({ user }: { user: string }) {
    const session = `session-${user.toLowerCase()}`;
    const expiresAt = this.clock().getTime() + SESSION_LIFETIME_MS;
    this.sessions.set(session, { user, expiresAt });
    return {
      session,
      expiresAt: new Date(expiresAt),
      user,
    };
  }

  current({ session }: { session: string }) {
    const found = activeSession(this.sessions, session, this.clock().getTime());
    return { user: found.user };
  }

  end({ session }: { session: string }) {
    activeSession(this.sessions, session, this.clock().getTime());
    this.sessions.delete(session);
    return { ended: true };
  }
}
