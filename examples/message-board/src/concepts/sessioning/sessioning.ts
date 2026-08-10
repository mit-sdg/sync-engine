export class UnknownSession extends Error {}

type Session = { subject: string; expiresAt: number };

const SESSION_LIFETIME_MS = 30 * 60 * 1000;

export class SessioningConcept {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly freshSession: () => string = () => crypto.randomUUID(),
  ) {}

  start({ subject }: { subject: string }) {
    const session = this.freshSession();
    const expiresAt = this.clock().getTime() + SESSION_LIFETIME_MS;
    this.sessions.set(session, { subject, expiresAt });
    return { session, expiresAt: new Date(expiresAt) };
  }

  current({ session }: { session: string }) {
    return { subject: this.#active(session).subject };
  }

  end({ session }: { session: string }) {
    this.#active(session);
    this.sessions.delete(session);
    return { ended: true };
  }

  _active({ session }: { session: string }): Array<{ subject: string; expiresAt: Date }> {
    const found = this.sessions.get(session);
    if (found === undefined || found.expiresAt <= this.clock().getTime()) return [];
    return [{ subject: found.subject, expiresAt: new Date(found.expiresAt) }];
  }

  #active(session: string): Session {
    const found = this.sessions.get(session);
    if (found === undefined) throw new UnknownSession("This session is not active.");
    if (found.expiresAt <= this.clock().getTime()) {
      this.sessions.delete(session);
      throw new UnknownSession("This session is not active.");
    }
    return found;
  }
}
