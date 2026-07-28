export class UnknownSession extends Error {}

export class SessioningConcept {
  private readonly sessions = new Map<string, string>();

  start({ user }: { user: string }) {
    const session = `session-${user.toLowerCase()}`;
    this.sessions.set(session, user);
    return {
      session,
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      user,
    };
  }

  current({ session }: { session: string }) {
    const user = this.sessions.get(session);
    if (user === undefined) throw new UnknownSession("This session is not active.");
    return { user };
  }

  end({ session }: { session: string }) {
    if (!this.sessions.delete(session)) {
      throw new UnknownSession("This session is not active.");
    }
    return { ended: true };
  }
}
