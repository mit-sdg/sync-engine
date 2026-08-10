import { MongoClient, type Db } from "mongodb";
import { expect, test } from "vite-plus/test";
import { EntryEventConflict, type RecordInput } from "./auditing.shared.ts";
import { AuditingMongoConcept, ensureAuditingIndexes } from "./auditing.mongo.ts";

const environment = (
  globalThis as unknown as { process: { env: Record<string, string | undefined> } }
).process.env;
const enabled = environment.MONGODB_URI !== undefined && environment.CATALOG_SKIP_MONGO !== "1";
const AT = new Date("2026-08-10T09:00:00.000Z");

async function withDatabase(run: (db: Db) => Promise<void>): Promise<void> {
  const client = new MongoClient(environment.MONGODB_URI ?? "");
  await client.connect();
  const db = client.db(`catalog_auditing_c_${crypto.randomUUID()}`);
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

function ask(event: string, target: string): RecordInput {
  return {
    trail: "workspace-1",
    event,
    actor: "ari",
    action: "reservation.hold",
    detail: "",
    target,
    at: AT,
  };
}

function rejected(results: PromiseSettledResult<unknown>[]): PromiseRejectedResult[] {
  return results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
}

function fulfilled<T>(results: PromiseSettledResult<T>[]): T[] {
  return results
    .filter((result): result is PromiseFulfilledResult<T> => result.status === "fulfilled")
    .map(({ value }) => value);
}

test.skipIf(!enabled)("Auditing mongo numbers concurrent entries without a gap", async () => {
  await withDatabase(async (db) => {
    await ensureAuditingIndexes(db);
    const auditing = new AuditingMongoConcept(db);
    const events = ["a", "b", "c", "d", "e", "f", "g", "h"];

    const recorded = await Promise.all(
      events.map((event) => auditing.record(ask(`evt-${event}`, `slot-${event}`))),
    );

    expect(recorded.map(({ position }) => position).sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(new Set(recorded.map(({ entry }) => entry)).size).toBe(events.length);
    expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 8, last: 8 });
    expect(
      (await auditing._since({ trail: "workspace-1", after: 0 })).map(({ position }) => position),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

test.skipIf(!enabled)(
  "Auditing mongo records one entry for a concurrently replayed event",
  async () => {
    await withDatabase(async (db) => {
      await ensureAuditingIndexes(db);
      const auditing = new AuditingMongoConcept(db);

      const replays = await Promise.all(
        Array.from({ length: 4 }, () => auditing.record(ask("evt-1", "slot-4"))),
      );
      expect(new Set(replays.map(({ entry }) => entry)).size).toBe(1);
      expect(replays.every(({ position }) => position === 1)).toBe(true);
      expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 1, last: 1 });

      const conflicts = await Promise.allSettled([
        auditing.record(ask("evt-2", "slot-1")),
        auditing.record(ask("evt-2", "slot-2")),
        auditing.record(ask("evt-2", "slot-3")),
      ]);
      expect(fulfilled(conflicts)).toHaveLength(1);
      for (const refused of rejected(conflicts))
        expect(refused.reason).toBeInstanceOf(EntryEventConflict);
      expect(await auditing._extent({ trail: "workspace-1" })).toEqual({ entries: 2, last: 2 });
    });
  },
);
