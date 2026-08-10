import { MongoClient } from "mongodb";
import { test } from "vite-plus/test";
import { exerciseApprovingBehavior, identities } from "./approving.behavior.ts";
import { ApprovingMongoConcept } from "./approving.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

test.skipIf(!enabled)("Approving mongo principle and refusals", async () => {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_approving_${crypto.randomUUID()}`);
  try {
    const approving = new ApprovingMongoConcept(
      db,
      identities(
        "review-9",
        "review-8",
        "review-7",
        "review-6",
        "review-5",
        "review-4",
        "review-3",
        "review-2",
        "review-1",
      ),
    );
    await exerciseApprovingBehavior(approving);
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  }
});
