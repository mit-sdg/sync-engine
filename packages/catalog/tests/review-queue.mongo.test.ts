import { MongoClient } from "mongodb";
import { test, vi } from "vite-plus/test";
import { applicationConceptSet } from "../entries/_typecheck/concept-set.ts";
import {
  exerciseReviewQueue,
  exerciseReviewQueueRepair,
  type CatalogInstances,
} from "../entries/recipe/review-queue/review-queue.behavior.ts";

const enabled = process.env.MONGODB_URI !== undefined && process.env.CATALOG_SKIP_MONGO !== "1";

async function withMongoFloor(run: (instances: CatalogInstances) => Promise<void>): Promise<void> {
  const client = new MongoClient(process.env.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`review_queue_${crypto.randomUUID()}`);
  try {
    const instances = applicationConceptSet.implementations("mongo", { db });
    await run(instances);
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
}

test.skipIf(!enabled)("Review Queue runs against the real Mongo floor", async () => {
  await withMongoFloor(exerciseReviewQueue);
});

test.skipIf(!enabled)(
  "Review Queue repairs interrupted effects on the real Mongo floor",
  async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withMongoFloor(exerciseReviewQueueRepair);
    } finally {
      reported.mockRestore();
    }
  },
);
