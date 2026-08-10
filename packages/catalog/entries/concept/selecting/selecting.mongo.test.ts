import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import { selectingConformance } from "./selecting.conformance.ts";
import { ensureSelectingIndexes, SelectingMongoConcept } from "./selecting.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("No deterministic identity remains.");
    return identity;
  };
}

async function requireTransactionTopology(db: Db): Promise<void> {
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
      "The Selecting Mongo floor requires a transaction-capable replica set or sharded cluster.",
    );
}

describe("Selecting mongo", () => {
  selectingConformance(
    "mongo",
    async (identities) => {
      const client = new MongoClient(environment.MONGODB_URI ?? "");
      await client.connect();
      const db = client.db(`catalog_selecting_${crypto.randomUUID()}`);
      try {
        await requireTransactionTopology(db);
      } catch (error) {
        await client.close();
        throw error;
      }
      return {
        concept: new SelectingMongoConcept(db, identityReader(identities)),
        close: async () => {
          try {
            await db.dropDatabase();
          } finally {
            await client.close();
          }
        },
      };
    },
    !enabled,
  );

  test.skipIf(!enabled)("rolls back history when the current projection write faults", async () => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_selecting_rollback_${crypto.randomUUID()}`);
    try {
      await requireTransactionTopology(db);
      await ensureSelectingIndexes(db);
      await db.command({
        collMod: "current_selections",
        validator: { scope: { $ne: "rolled-back-scope" } },
        validationAction: "error",
        validationLevel: "strict",
      });
      const selecting = new SelectingMongoConcept(db, identityReader(["rolled-back-selection"]));

      await expect(
        selecting.choose({ scope: "rolled-back-scope", item: "Interrupted item" }),
      ).rejects.toMatchObject({ code: 121 });
      expect(await selecting._get({ selection: "rolled-back-selection" })).toEqual([]);
      expect(await selecting._current({ scope: "rolled-back-scope" })).toEqual([]);
      expect(await db.collection("selections").countDocuments({ scope: "rolled-back-scope" })).toBe(
        0,
      );
    } finally {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    }
  });
});
