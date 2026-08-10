import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import {
  DiscussionAlreadyOpen,
  DiscussionNotOpen,
  InvalidResponseText,
} from "./discussing.shared.ts";
import { DiscussingMongoConcept } from "./discussing.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
const instant = (minute: number) =>
  new Date(`2099-07-20T12:${String(minute).padStart(2, "0")}:00.000Z`);

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  try {
    await client.connect();
    const db = client.db(`catalog_discussing_${crypto.randomUUID()}`);
    try {
      const hello = (await db.admin().command({ hello: 1 })) as {
        logicalSessionTimeoutMinutes?: unknown;
        msg?: unknown;
        setName?: unknown;
      };
      if (
        typeof hello.logicalSessionTimeoutMinutes !== "number" ||
        (typeof hello.setName !== "string" && hello.msg !== "isdbgrid")
      )
        throw new Error(
          "The Discussing Mongo floor requires a transaction-capable replica set or sharded cluster.",
        );
      await run(db);
    } finally {
      await db.dropDatabase();
    }
  } finally {
    await client.close();
  }
}

async function rejection(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return undefined;
}

function rejected(results: PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
}

describe("Discussing mongo", () => {
  test.skipIf(!enabled)("its principle, refusals, and response order", async () => {
    await withDatabase(async (db) => {
      const ids = ["discussion-1", "response-z", "response-b", "response-a", "discussion-2"];
      const discussing = new DiscussingMongoConcept(db, () => ids.shift() ?? "unexpected");

      expect(await discussing.open({ subject: "p1", at: instant(0) })).toEqual({
        discussion: "discussion-1",
      });
      expect(await discussing._openFor({ subject: "p1" })).toEqual([
        { discussion: "discussion-1", openedAt: instant(0) },
      ]);

      const duplicate = await rejection(() => discussing.open({ subject: "p1", at: instant(1) }));
      expect(duplicate).toBeInstanceOf(DiscussionAlreadyOpen);
      expect((duplicate as Error).message).toBe("This subject already has an open discussion.");

      for (const text of [" \n\t", "x".repeat(2001)]) {
        const invalid = await rejection(() =>
          discussing.respond({
            discussion: "discussion-1",
            author: "Sol",
            text,
            at: instant(2),
          }),
        );
        expect(invalid).toBeInstanceOf(InvalidResponseText);
        expect((invalid as Error).message).toBe(
          "A response must not be blank and must be at most 2000 characters.",
        );
      }
      expect(await discussing._responses({ discussion: "discussion-1" })).toEqual([]);

      await discussing.respond({
        discussion: "discussion-1",
        author: "Sol",
        text: "third",
        at: instant(3),
      });
      await discussing.respond({
        discussion: "discussion-1",
        author: "Mina",
        text: "first",
        at: instant(2),
      });
      await discussing.respond({
        discussion: "discussion-1",
        author: "Ari",
        text: "second",
        at: instant(3),
      });
      expect(
        (await discussing._responses({ discussion: "discussion-1" })).map(
          ({ response }) => response,
        ),
      ).toEqual(["response-b", "response-a", "response-z"]);
      expect(await discussing._response({ response: "response-b" })).toEqual([
        {
          discussion: "discussion-1",
          author: "Mina",
          text: "first",
          addedAt: instant(2),
        },
      ]);

      expect(await discussing.close({ discussion: "discussion-1", at: instant(4) })).toEqual({
        discussion: "discussion-1",
      });
      expect(await discussing._openFor({ subject: "p1" })).toEqual([]);
      const late = await rejection(() =>
        discussing.respond({
          discussion: "discussion-1",
          author: "Sol",
          text: "Later",
          at: instant(5),
        }),
      );
      expect(late).toBeInstanceOf(DiscussionNotOpen);
      expect((late as Error).message).toBe("This discussion is not open.");
      expect(
        await rejection(() => discussing.close({ discussion: "discussion-1", at: instant(5) })),
      ).toBeInstanceOf(DiscussionNotOpen);

      expect(await discussing.open({ subject: "p1", at: instant(6) })).toEqual({
        discussion: "discussion-2",
      });
      expect(await discussing._responses({ discussion: "missing" })).toEqual([]);
      expect(await discussing._response({ response: "missing" })).toEqual([]);
    });
  });

  test.skipIf(!enabled)(
    "uses unique indexes and transactions for open, respond-versus-close, and close races",
    async () => {
      await withDatabase(async (db) => {
        const openingIDs = ["opening-a", "opening-b"];
        const opening = new DiscussingMongoConcept(
          db,
          () => openingIDs.shift() ?? "unexpected-opening",
        );
        const opens = await Promise.allSettled([
          opening.open({ subject: "opening", at: instant(0) }),
          opening.open({ subject: "opening", at: instant(0) }),
        ]);
        expect(opens.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(rejected(opens)[0]).toBeInstanceOf(DiscussionAlreadyOpen);
        expect(await opening._openFor({ subject: "opening" })).toHaveLength(1);

        const responseIDs = ["atomic-discussion", "atomic-response"];
        const responding = new DiscussingMongoConcept(
          db,
          () => responseIDs.shift() ?? "unexpected-response",
        );
        await responding.open({ subject: "atomic", at: instant(0) });
        const respondAndClose = await Promise.allSettled([
          responding.respond({
            discussion: "atomic-discussion",
            author: "Sol",
            text: "Response",
            at: instant(1),
          }),
          responding.close({ discussion: "atomic-discussion", at: instant(2) }),
        ]);
        expect(respondAndClose[1]?.status).toBe("fulfilled");
        const responses = await responding._responses({ discussion: "atomic-discussion" });
        if (respondAndClose[0]?.status === "fulfilled") {
          expect(responses).toHaveLength(1);
        } else {
          expect(respondAndClose[0]?.reason).toBeInstanceOf(DiscussionNotOpen);
          expect(responses).toEqual([]);
        }

        const closing = new DiscussingMongoConcept(db, () => "close-discussion");
        await closing.open({ subject: "closing", at: instant(0) });
        const closes = await Promise.allSettled([
          closing.close({ discussion: "close-discussion", at: instant(1) }),
          closing.close({ discussion: "close-discussion", at: instant(1) }),
        ]);
        expect(closes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(rejected(closes)).toHaveLength(1);
        expect(rejected(closes)[0]).toBeInstanceOf(DiscussionNotOpen);
      });
    },
  );
});
