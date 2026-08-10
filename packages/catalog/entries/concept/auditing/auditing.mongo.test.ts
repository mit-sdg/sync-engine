import { MongoClient } from "mongodb";
import { auditingConformance } from "./auditing.conformance.ts";
import { AuditingMongoConcept } from "./auditing.mongo.ts";

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

auditingConformance(
  "mongo",
  async (identities) => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_auditing_${crypto.randomUUID()}`);
    return {
      concept: new AuditingMongoConcept(db, identityReader(identities)),
      close: async () => {
        await db.dropDatabase();
        await client.close();
      },
    };
  },
  !enabled,
);
