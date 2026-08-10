import { MongoClient } from "mongodb";
import { describe } from "vite-plus/test";
import { defineReservingConformance } from "./reserving.conformance.ts";
import { ReservingMongoConcept } from "./reserving.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

function identities(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("Identity fixture exhausted.");
    return identity;
  };
}

describe.skipIf(!enabled)("Reserving mongo", () => {
  defineReservingConformance(async (values) => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_reserving_${crypto.randomUUID()}`);
    return {
      concept: new ReservingMongoConcept({ db, freshID: identities(values) }),
      close: async () => {
        try {
          await db.dropDatabase();
        } finally {
          await client.close();
        }
      },
    };
  });
});
