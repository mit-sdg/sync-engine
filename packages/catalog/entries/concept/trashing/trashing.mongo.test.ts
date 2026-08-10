import { MongoClient } from "mongodb";
import { trashingConformance } from "./trashing.conformance.ts";
import { TrashingMongoConcept } from "./trashing.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

trashingConformance(
  "mongo",
  async () => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_trashing_${crypto.randomUUID()}`);
    return {
      concept: new TrashingMongoConcept(db),
      close: async () => {
        await db.dropDatabase();
        await client.close();
      },
    };
  },
  !enabled,
);
