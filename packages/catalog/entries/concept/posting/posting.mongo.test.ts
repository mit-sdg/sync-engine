import { MongoClient } from "mongodb";
import { postingConformance } from "./posting.conformance.ts";
import { PostingMongoConcept } from "./posting.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

postingConformance(
  "mongo",
  async (identities) => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_posting_${crypto.randomUUID()}`);
    return {
      concept: new PostingMongoConcept(db, identityReader(identities)),
      close: async () => {
        await db.dropDatabase();
        await client.close();
      },
    };
  },
  !enabled,
);
