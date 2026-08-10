import { MongoClient, type Db } from "mongodb";
import { expect, test } from "vite-plus/test";
import {
  ReviewAlreadyPending,
  ReviewNotPendingForRequester,
  ReviewNotPendingForReviewer,
} from "./approving.shared.ts";
import { ApprovingMongoConcept, ensureApprovingIndexes } from "./approving.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_approving_c_${crypto.randomUUID()}`);
  try {
    await run(db);
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
}

function rejected(results: PromiseSettledResult<unknown>[]): PromiseRejectedResult[] {
  return results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
}

function fulfilled<T>(results: PromiseSettledResult<T>[]): PromiseFulfilledResult<T>[] {
  return results.filter(
    (result): result is PromiseFulfilledResult<T> => result.status === "fulfilled",
  );
}

test.skipIf(!enabled)("Approving mongo serializes concurrent pending requests", async () => {
  await withDatabase(async (db) => {
    await ensureApprovingIndexes(db);
    const pendingIndex = (await db.collection("approving_reviews").indexes()).find(
      (index) => index.name === "approving_one_pending_review_per_subject",
    );
    expect(pendingIndex).toMatchObject({
      key: { subject: 1 },
      unique: true,
      partialFilterExpression: { status: "pending" },
    });

    const approving = new ApprovingMongoConcept(db);
    const requestedAt = new Date("2025-02-01T09:00:00.000Z");
    const attempts = await Promise.allSettled([
      approving.request({
        subject: "change-concurrent",
        requester: "Ari",
        reviewer: "Bo",
        at: requestedAt,
      }),
      approving.request({
        subject: "change-concurrent",
        requester: "Cy",
        reviewer: "Dia",
        at: requestedAt,
      }),
    ]);

    expect(fulfilled(attempts)).toHaveLength(1);
    expect(rejected(attempts)).toHaveLength(1);
    expect(rejected(attempts)[0]?.reason).toBeInstanceOf(ReviewAlreadyPending);
    expect(await approving._history({ subject: "change-concurrent" })).toHaveLength(1);
  });
});

test.skipIf(!enabled)("Approving mongo allows one concurrent terminal transition", async () => {
  await withDatabase(async (db) => {
    const approving = new ApprovingMongoConcept(db);
    const requestedAt = new Date("2025-02-02T09:00:00.000Z");
    const decidedAt = new Date("2025-02-02T10:00:00.000Z");

    const decision = await approving.request({
      subject: "change-decision-race",
      requester: "Ari",
      reviewer: "Bo",
      at: requestedAt,
    });
    const decisions = await Promise.allSettled([
      approving.approve({ review: decision.review, reviewer: "Bo", at: decidedAt }),
      approving.reject({
        review: decision.review,
        reviewer: "Bo",
        reason: "The change needs revision.",
        at: decidedAt,
      }),
    ]);

    expect(fulfilled(decisions)).toHaveLength(1);
    expect(rejected(decisions)).toHaveLength(1);
    expect(rejected(decisions)[0]?.reason).toBeInstanceOf(ReviewNotPendingForReviewer);
    const [decided] = await approving._get(decision);
    expect(["approved", "rejected"]).toContain(decided?.status);
    expect(decided?.decidedAt).toEqual(decidedAt);
    expect(decided?.reason).toBe(
      decided?.status === "rejected" ? "The change needs revision." : undefined,
    );

    const withdrawal = await approving.request({
      subject: "change-withdrawal-race",
      requester: "Cy",
      reviewer: "Dia",
      at: requestedAt,
    });
    const withdrawalRace = await Promise.allSettled([
      approving.reject({
        review: withdrawal.review,
        reviewer: "Dia",
        reason: "The change needs revision.",
        at: decidedAt,
      }),
      approving.withdraw({ review: withdrawal.review, requester: "Cy", at: decidedAt }),
    ]);

    expect(fulfilled(withdrawalRace)).toHaveLength(1);
    expect(rejected(withdrawalRace)).toHaveLength(1);
    const refusal = rejected(withdrawalRace)[0]?.reason;
    expect(
      refusal instanceof ReviewNotPendingForReviewer ||
        refusal instanceof ReviewNotPendingForRequester,
    ).toBe(true);
    const [finished] = await approving._get(withdrawal);
    expect(["rejected", "withdrawn"]).toContain(finished?.status);
    expect(finished?.decidedAt).toEqual(decidedAt);
    expect(finished?.reason).toBe(
      finished?.status === "rejected" ? "The change needs revision." : undefined,
    );
  });
});
