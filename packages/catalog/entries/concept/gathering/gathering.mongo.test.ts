import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import { describe, expect, test } from "vite-plus/test";
import { gatheringConformance } from "./gathering.conformance.ts";
import { ensureGatheringIndexes, GatheringMongoConcept } from "./gathering.mongo.ts";

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
      "The Gathering Mongo floor requires a transaction-capable replica set or sharded cluster.",
    );
}

describe("Gathering mongo", () => {
  gatheringConformance(
    "mongo",
    async (identities) => {
      const client = new MongoClient(environment.MONGODB_URI ?? "");
      await client.connect();
      const db = client.db(`catalog_gathering_${crypto.randomUUID()}`);
      try {
        await requireTransactionTopology(db);
      } catch (error) {
        await client.close();
        throw error;
      }
      return {
        concept: new GatheringMongoConcept(db, identityReader(identities)),
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

  test.skipIf(!enabled)("rolls back creation when the host membership write faults", async () => {
    const client = new MongoClient(environment.MONGODB_URI ?? "");
    await client.connect();
    const db = client.db(`catalog_gathering_rollback_${crypto.randomUUID()}`);
    try {
      await requireTransactionTopology(db);
      await ensureGatheringIndexes(db);
      await db.command({
        collMod: "gathering_memberships",
        validator: { gathering: { $ne: "rolled-back-gathering" } },
        validationAction: "error",
        validationLevel: "strict",
      });
      const gathering = new GatheringMongoConcept(
        db,
        identityReader(["rolled-back-gathering", "host-membership"]),
      );

      await expect(
        gathering.create({ name: "Interrupted Workshop", host: "Asha" }),
      ).rejects.toMatchObject({ code: 121 });
      expect(await gathering._get({ gathering: "rolled-back-gathering" })).toEqual([]);
      expect(
        await gathering._membership({ gathering: "rolled-back-gathering", member: "Asha" }),
      ).toEqual({ joined: false });
      expect(
        await db.collection("gatherings").countDocuments({ gathering: "rolled-back-gathering" }),
      ).toBe(0);
    } finally {
      try {
        await db.dropDatabase();
      } finally {
        await client.close();
      }
    }
  });
});
