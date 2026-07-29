export class UnknownSession extends Error {}

type Session = { expiresAt: number };

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
  private readonly runtime: { clock: () => Date; freshCredential: () => string };

  constructor(
    clock: () => Date = () => new Date(),
    freshCredential: () => string = () => crypto.randomUUID(),
  ) {
    this.runtime = { clock, freshCredential };
  }

  start(_input: Record<string, never>) {
    const session = this.runtime.freshCredential();
    const expiresAt = this.runtime.clock().getTime() + SESSION_LIFETIME_MS;
    this.sessions.set(session, { expiresAt });
    return {
      session,
      expiresAt: new Date(expiresAt),
    };
  }

  current({ session }: { session: string }) {
    activeSession(this.sessions, session, this.runtime.clock().getTime());
    return { active: true };
  }

  end({ session }: { session: string }) {
    activeSession(this.sessions, session, this.runtime.clock().getTime());
    this.sessions.delete(session);
    return { ended: true };
  }
}
