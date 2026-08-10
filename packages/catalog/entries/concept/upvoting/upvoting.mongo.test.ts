import { MongoClient, type Db } from "mongodb";
import { expect, test } from "vite-plus/test";
import { expectUpvotingConformance } from "./upvoting.conformance.ts";
import { UpvotingMongoConcept, ensureUpvotingIndexes } from "./upvoting.mongo.ts";
import { AlreadyDownvoted, AlreadyUpvoted, type VoteRecord } from "./upvoting.shared.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

async function withDatabase(name: string, run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_upvoting_${name}_${crypto.randomUUID()}`);
  try {
    await run(db);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

async function expectCoherentSingleVoterScore(
  upvoting: UpvotingMongoConcept,
  item: string,
  voter: string,
): Promise<void> {
  const vote = await upvoting._vote({ item, voter });
  const expectedScore = vote.length === 0 ? 0 : vote[0]?.direction === "up" ? 1 : -1;
  expect(await upvoting._score({ item })).toEqual({ score: expectedScore });
}

test.skipIf(!enabled)("Upvoting mongo principle and refusals", async () => {
  await withDatabase("principle", async (db) => {
    await expectUpvotingConformance(new UpvotingMongoConcept(db));
  });
});

test.skipIf(!enabled)("Upvoting mongo storage enforces one vote per voter and item", async () => {
  await withDatabase("unique", async (db) => {
    await ensureUpvotingIndexes(db);
    const votes = db.collection<VoteRecord>("upvoting_votes");
    await votes.insertOne({ item: "p1", voter: "Ari", direction: "up" });
    await expect(
      votes.insertOne({ item: "p1", voter: "Ari", direction: "down" }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(await votes.countDocuments({ item: "p1", voter: "Ari" })).toBe(1);
  });
});

test.skipIf(!enabled)("Upvoting mongo transitions remain coherent under races", async () => {
  await withDatabase("races", async (db) => {
    const upvoting = new UpvotingMongoConcept(db);

    const repeatedFirstVotes = await Promise.allSettled([
      upvoting.upvote({ item: "same-first", voter: "Ari" }),
      upvoting.upvote({ item: "same-first", voter: "Ari" }),
    ]);
    expect(repeatedFirstVotes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const repeatedFirstRefusal = repeatedFirstVotes.find(({ status }) => status === "rejected") as
      | { status: "rejected"; reason: unknown }
      | undefined;
    expect(repeatedFirstRefusal?.reason).toBeInstanceOf(AlreadyUpvoted);
    expect(await upvoting._score({ item: "same-first" })).toEqual({ score: 1 });

    const oppositeFirstVotes = await Promise.all([
      upvoting.upvote({ item: "opposite-first", voter: "Bo" }),
      upvoting.downvote({ item: "opposite-first", voter: "Bo" }),
    ]);
    expect(oppositeFirstVotes).toHaveLength(2);
    await expectCoherentSingleVoterScore(upvoting, "opposite-first", "Bo");
    expect(
      await db.collection<VoteRecord>("upvoting_votes").countDocuments({
        item: "opposite-first",
        voter: "Bo",
      }),
    ).toBe(1);

    await upvoting.upvote({ item: "switch", voter: "Cy" });
    const oppositeChanges = await Promise.allSettled([
      upvoting.downvote({ item: "switch", voter: "Cy" }),
      upvoting.upvote({ item: "switch", voter: "Cy" }),
    ]);
    expect(oppositeChanges[0]?.status).toBe("fulfilled");
    if (oppositeChanges[1]?.status === "rejected")
      expect(oppositeChanges[1].reason).toBeInstanceOf(AlreadyUpvoted);
    await expectCoherentSingleVoterScore(upvoting, "switch", "Cy");

    await upvoting.upvote({ item: "unvote-switch", voter: "Dee" });
    const unvoteAndSwitch = await Promise.allSettled([
      upvoting.unvote({ item: "unvote-switch", voter: "Dee" }),
      upvoting.downvote({ item: "unvote-switch", voter: "Dee" }),
    ]);
    expect(unvoteAndSwitch.every(({ status }) => status === "fulfilled")).toBe(true);
    await expectCoherentSingleVoterScore(upvoting, "unvote-switch", "Dee");

    await upvoting.upvote({ item: "same-change", voter: "Eli" });
    const repeatedChanges = await Promise.allSettled([
      upvoting.downvote({ item: "same-change", voter: "Eli" }),
      upvoting.downvote({ item: "same-change", voter: "Eli" }),
    ]);
    expect(repeatedChanges.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const repeatedChangeRefusal = repeatedChanges.find(({ status }) => status === "rejected") as
      | { status: "rejected"; reason: unknown }
      | undefined;
    expect(repeatedChangeRefusal?.reason).toBeInstanceOf(AlreadyDownvoted);
    expect(await upvoting._score({ item: "same-change" })).toEqual({ score: -1 });
  });
});
