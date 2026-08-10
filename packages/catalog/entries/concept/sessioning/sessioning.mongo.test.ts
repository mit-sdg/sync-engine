import { MongoClient, type Db } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import {
  UnknownSession,
  UNKNOWN_SESSION_DETAIL,
  type SessionDocument,
} from "./sessioning.shared.ts";
import {
  digestSessionToken,
  ensureSessioningIndexes,
  SessioningMongoConcept,
} from "./sessioning.mongo.ts";

const enabled = process.env.MONGODB_URI !== undefined && process.env.CATALOG_SKIP_MONGO !== "1";
const START = new Date("2099-07-20T12:00:00.000Z");

function token(character: string): string {
  return character.repeat(43);
}

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(process.env.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_sessioning_${crypto.randomUUID()}`);
  try {
    await run(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

describe.skipIf(!enabled)("Sessioning mongo", () => {
  test("its principle: a fixed-lifetime session starts, resolves, ends, and expires", async () => {
    await withDatabase(async (db) => {
      let now = new Date(START);
      const values = [token("A"), token("B")];
      const sessioning = new SessioningMongoConcept(db, {
        clock: () => now,
        freshSession: () => values.shift() ?? "unexpected",
      });

      const started = await sessioning.start({ subject: "ari" });
      expect(started).toEqual({
        session: token("A"),
        expiresAt: new Date("2099-07-20T12:30:00.000Z"),
      });
      expect(await sessioning._active({ session: started.session })).toEqual([
        { subject: "ari", expiresAt: started.expiresAt },
      ]);
      expect(await sessioning.current({ session: started.session })).toEqual({ subject: "ari" });
      expect(await sessioning.end({ session: started.session })).toEqual({ ended: true });

      for (const session of [started.session, token("Z")]) {
        await expect(sessioning.current({ session })).rejects.toThrow(UnknownSession);
        await expect(sessioning.current({ session })).rejects.toThrow(UNKNOWN_SESSION_DETAIL);
      }

      const expiring = await sessioning.start({ subject: "ari" });
      now = new Date("2099-07-20T12:29:59.999Z");
      expect(await sessioning.current({ session: expiring.session })).toEqual({ subject: "ari" });
      expect(await sessioning._active({ session: expiring.session })).toEqual([
        { subject: "ari", expiresAt: new Date("2099-07-20T12:30:00.000Z") },
      ]);
      now = new Date("2099-07-20T12:30:00.000Z");
      expect(await sessioning._active({ session: expiring.session })).toEqual([]);
      await expect(sessioning.current({ session: expiring.session })).rejects.toThrow(
        UnknownSession,
      );
      await expect(sessioning.end({ session: expiring.session })).rejects.toThrow(UnknownSession);
    });
  });

  test("stores only a bearer digest and treats TTL as delayed cleanup", async () => {
    await withDatabase(async (db) => {
      let now = new Date(START);
      const bearer = token("S");
      const sessioning = new SessioningMongoConcept(db, {
        clock: () => now,
        freshSession: () => bearer,
      });
      await sessioning.start({ subject: "ari" });

      const stored = await db.collection<SessionDocument>("sessioning_sessions").findOne({});
      expect(stored?.sessionDigest).toBe(digestSessionToken(bearer));
      expect(JSON.stringify(stored)).not.toContain(bearer);

      const indexes = await db.collection("sessioning_sessions").listIndexes().toArray();
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: { sessionDigest: 1 }, unique: true }),
          expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
        ]),
      );

      now = new Date("2099-07-20T12:30:00.000Z");
      expect(await sessioning._active({ session: bearer })).toEqual([]);
      await expect(sessioning.current({ session: bearer })).rejects.toThrow(UnknownSession);
      expect(
        await db
          .collection<SessionDocument>("sessioning_sessions")
          .countDocuments({ sessionDigest: digestSessionToken(bearer) }),
      ).toBe(1);
    });
  });

  test("unique digests reject collisions and end linearizes against concurrent use", async () => {
    await withDatabase(async (db) => {
      await ensureSessioningIndexes(db);
      const first = token("A");
      const second = token("B");
      const values = [first, first, second];
      const sessioning = new SessioningMongoConcept(db, {
        clock: () => START,
        freshSession: () => values.shift() ?? "unexpected",
      });
      expect((await sessioning.start({ subject: "ari" })).session).toBe(first);
      expect((await sessioning.start({ subject: "bo" })).session).toBe(second);
      expect(await sessioning.current({ session: first })).toEqual({ subject: "ari" });

      const [ending, resolving] = await Promise.allSettled([
        sessioning.end({ session: first }),
        sessioning.current({ session: first }),
      ]);
      expect(ending).toEqual({ status: "fulfilled", value: { ended: true } });
      if (resolving.status === "rejected") expect(resolving.reason).toBeInstanceOf(UnknownSession);
      else expect(resolving.value).toEqual({ subject: "ari" });
      await expect(sessioning.current({ session: first })).rejects.toThrow(UnknownSession);

      const endings = await Promise.allSettled([
        sessioning.end({ session: second }),
        sessioning.end({ session: second }),
      ]);
      expect(endings.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(endings.filter(({ status }) => status === "rejected")).toHaveLength(1);
    });
  });
});
