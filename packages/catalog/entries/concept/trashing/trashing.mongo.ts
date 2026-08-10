import type { Collection, Db } from "mongodb";
import {
  ItemAlreadyTrashed,
  ItemNotTrashed,
  ItemPurged,
  type DispositionRecord,
  type DispositionStatus,
} from "./trashing.shared.ts";

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureTrashingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const dispositions = db.collection<DispositionRecord>("trashing_dispositions");
    ready = Promise.all([
      dispositions.createIndex({ item: 1 }, { unique: true }),
      dispositions.createIndex({ status: 1, trashedAt: 1, item: 1 }),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class TrashingMongoConcept {
  private readonly dispositions: Collection<DispositionRecord>;

  constructor(private readonly db: Db) {
    this.dispositions = db.collection("trashing_dispositions");
  }

  async trash({ item, at }: { item: string; at: Date }) {
    const trashedAt = new Date(at.getTime());
    await ensureTrashingIndexes(this.db);

    while (true) {
      const found = await this.dispositions.findOne(
        { item },
        { projection: { _id: 0, status: 1 } },
      );
      if (found === null) {
        try {
          await this.dispositions.insertOne({ item, status: "trashed", trashedAt });
          return { item };
        } catch (error) {
          if (duplicate(error)) continue;
          throw error;
        }
      }
      if (found.status === "purged") throw new ItemPurged();
      if (found.status === "trashed") throw new ItemAlreadyTrashed();

      const changed = await this.dispositions.updateOne(
        { item, status: "active" },
        {
          $set: { status: "trashed", trashedAt },
          $unset: { purgedAt: "" },
        },
      );
      if (changed.modifiedCount === 1) return { item };
    }
  }

  async restore({ item }: { item: string }) {
    await ensureTrashingIndexes(this.db);

    while (true) {
      const found = await this.dispositions.findOne(
        { item },
        { projection: { _id: 0, status: 1 } },
      );
      if (found?.status === "purged") throw new ItemPurged();
      if (found?.status !== "trashed") throw new ItemNotTrashed();

      const changed = await this.dispositions.updateOne(
        { item, status: "trashed" },
        {
          $set: { status: "active" },
          $unset: { trashedAt: "", purgedAt: "" },
        },
      );
      if (changed.modifiedCount === 1) return { item };
    }
  }

  async purge({ item, at }: { item: string; at: Date }) {
    const purgedAt = new Date(at.getTime());
    await ensureTrashingIndexes(this.db);

    while (true) {
      const found = await this.dispositions.findOne(
        { item },
        { projection: { _id: 0, status: 1 } },
      );
      if (found?.status === "purged") throw new ItemPurged();
      if (found?.status !== "trashed") throw new ItemNotTrashed();

      const changed = await this.dispositions.updateOne(
        { item, status: "trashed" },
        { $set: { status: "purged", purgedAt } },
      );
      if (changed.modifiedCount === 1) return { item };
    }
  }

  async _state({ item }: { item: string }): Promise<{ status: DispositionStatus }> {
    const found = await this.dispositions.findOne({ item }, { projection: { _id: 0, status: 1 } });
    return { status: found?.status ?? "active" };
  }

  async _trashed(_input: Record<string, never>): Promise<Array<{ item: string; trashedAt: Date }>> {
    const found = await this.dispositions
      .find(
        { status: "trashed", trashedAt: { $exists: true } },
        { projection: { _id: 0, item: 1, trashedAt: 1 } },
      )
      .sort({ trashedAt: 1, item: 1 })
      .toArray();
    return found.flatMap(({ item, trashedAt }) =>
      trashedAt === undefined ? [] : [{ item, trashedAt }],
    );
  }
}
