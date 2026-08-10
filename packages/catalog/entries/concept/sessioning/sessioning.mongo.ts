import { createHash } from "node:crypto";
import type { Collection, Db } from "mongodb";
import {
  secureSessionToken,
  SESSION_LIFETIME_MS,
  SESSION_TOKEN_ATTEMPTS,
  trustedTime,
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
  type SessionDocument,
  type SessioningDependencies,
} from "./sessioning.shared.ts";

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureSessioningIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = Promise.all([
      db
        .collection<SessionDocument>("sessioning_sessions")
        .createIndex({ sessionDigest: 1 }, { name: "session_digest_unique", unique: true }),
      db
        .collection<SessionDocument>("sessioning_sessions")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "session_expiry_cleanup" }),
    ]).then(() => undefined);
    indexes.set(db, ready);
    void ready.catch(() => indexes.delete(db));
  }
  return ready;
}

export function digestSessionToken(session: string): string {
  return createHash("sha256").update(session, "utf8").digest("base64url");
}

export class SessioningMongoConcept {
  private readonly sessions: Collection<SessionDocument>;
  private readonly clock: () => Date;
  private readonly freshSession: () => string;

  constructor(
    private readonly db: Db,
    { clock = () => new Date(), freshSession = secureSessionToken }: SessioningDependencies = {},
  ) {
    this.sessions = db.collection("sessioning_sessions");
    this.clock = clock;
    this.freshSession = freshSession;
  }

  async start({ subject }: { subject: string }) {
    await ensureSessioningIndexes(this.db);
    const now = trustedTime(this.clock);
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    for (let attempt = 0; attempt < SESSION_TOKEN_ATTEMPTS; attempt += 1) {
      const session = this.freshSession();
      try {
        await this.sessions.insertOne({
          sessionDigest: digestSessionToken(session),
          subject,
          expiresAt,
        });
        return { session, expiresAt: new Date(expiresAt) };
      } catch (error) {
        if (!duplicate(error)) throw error;
      }
    }
    throw new Error("The session token source repeatedly returned an existing bearer value.");
  }

  async current({ session }: { session: string }) {
    const found = await this.sessions.findOne(
      {
        sessionDigest: digestSessionToken(session),
        expiresAt: { $gt: trustedTime(this.clock) },
      },
      { projection: { _id: 0, subject: 1 } },
    );
    if (found === null) throw new UnknownSession(UNKNOWN_SESSION_DETAIL);
    return { subject: found.subject };
  }

  async end({ session }: { session: string }) {
    const found = await this.sessions.findOneAndDelete({
      sessionDigest: digestSessionToken(session),
      expiresAt: { $gt: trustedTime(this.clock) },
    });
    if (found === null) throw new UnknownSession(UNKNOWN_SESSION_DETAIL);
    return { ended: true };
  }

  async _active({
    session,
  }: {
    session: string;
  }): Promise<Array<{ subject: string; expiresAt: Date }>> {
    const found = await this.sessions.findOne(
      {
        sessionDigest: digestSessionToken(session),
        expiresAt: { $gt: trustedTime(this.clock) },
      },
      { projection: { _id: 0, subject: 1, expiresAt: 1 } },
    );
    return found === null ? [] : [{ subject: found.subject, expiresAt: new Date(found.expiresAt) }];
  }
}
