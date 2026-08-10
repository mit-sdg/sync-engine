import type { Db } from "mongodb";
import { MongoClient } from "mongodb";

interface CatalogMongoFloorLease {
  database: Db;
  close(): Promise<void>;
}

const environment = process.env;
if (environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1") {
  (
    globalThis as typeof globalThis & {
      __catalogMongoFloor?: () => Promise<CatalogMongoFloorLease>;
    }
  ).__catalogMongoFloor = async () => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const database = client.db(`catalog_recipe_${crypto.randomUUID()}`);
    return {
      database,
      async close() {
        try {
          await database.dropDatabase();
        } finally {
          await client.close();
        }
      },
    };
  };
}
