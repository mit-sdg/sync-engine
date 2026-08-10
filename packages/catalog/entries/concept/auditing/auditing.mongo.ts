import type { Collection, Db } from "mongodb";
import {
  acceptedEntry,
  actorEntry,
  entryDetails,
  POSITION_ATTEMPTS,
  replayed,
  targetEntry,
  trailEntry,
  type ActorEntryRecord,
  type EntryDetailsRecord,
  type EntryRecord,
  type RecordInput,
  type TargetEntryRecord,
  type TrailEntryRecord,
  type TrailExtentRecord,
} from "./auditing.shared.ts";

const ENTRY_FIELDS = {
  _id: 0,
  entry: 1,
  trail: 1,
  position: 1,
  event: 1,
  actor: 1,
  action: 1,
  detail: 1,
  target: 1,
  recordedAt: 1,
} as const;

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureAuditingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = db
      .collection<EntryRecord>("auditing_entries")
      .createIndexes([
        { key: { entry: 1 }, name: "auditing_entry_identity", unique: true },
        { key: { trail: 1, position: 1 }, name: "auditing_trail_position", unique: true },
        { key: { trail: 1, event: 1 }, name: "auditing_one_entry_per_event", unique: true },
        { key: { trail: 1, actor: 1, position: 1 }, name: "auditing_trail_actor_position" },
        { key: { trail: 1, target: 1, position: 1 }, name: "auditing_trail_target_position" },
      ])
      .then(() => undefined);
    indexes.set(db, ready);
    void ready.catch(() => indexes.delete(db));
  }
  return ready;
}

export class AuditingMongoConcept {
  private readonly entries: Collection<EntryRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.entries = db.collection("auditing_entries");
  }

  async record({ trail, event, actor, action, detail, target, at }: RecordInput) {
    acceptedEntry({ actor, action, detail, target });
    const recordedAt = new Date(at.getTime());
    await ensureAuditingIndexes(this.db);
    for (let attempt = 0; attempt < POSITION_ATTEMPTS; attempt += 1) {
      const recorded = await this.entries.findOne({ trail, event }, { projection: ENTRY_FIELDS });
      if (recorded !== null) return replayed(recorded, { actor, action, detail, target });
      const last = await this.entries.findOne(
        { trail },
        { projection: { _id: 0, position: 1 }, sort: { position: -1 } },
      );
      const position = (last?.position ?? 0) + 1;
      const entry = this.freshID();
      try {
        await this.entries.insertOne({
          entry,
          trail,
          position,
          event,
          actor,
          action,
          detail,
          target,
          recordedAt,
        });
        return { entry, position };
      } catch (error) {
        if (!duplicate(error)) throw error;
      }
    }
    throw new Error("Auditing could not take a trail position after repeated concurrent writes.");
  }

  async _get({ entry }: { entry: string }): Promise<EntryDetailsRecord[]> {
    const found = await this.entries.findOne({ entry }, { projection: ENTRY_FIELDS });
    return found === null ? [] : [entryDetails(found)];
  }

  async _since({ trail, after }: { trail: string; after: number }): Promise<TrailEntryRecord[]> {
    const found = await this.entries
      .find({ trail, position: { $gt: after } }, { projection: ENTRY_FIELDS })
      .sort({ position: 1 })
      .toArray();
    return found.map(trailEntry);
  }

  async _byActor({ trail, actor }: { trail: string; actor: string }): Promise<ActorEntryRecord[]> {
    const found = await this.entries
      .find({ trail, actor }, { projection: ENTRY_FIELDS })
      .sort({ position: 1 })
      .toArray();
    return found.map(actorEntry);
  }

  async _forTarget({
    trail,
    target,
  }: {
    trail: string;
    target: string;
  }): Promise<TargetEntryRecord[]> {
    const found = await this.entries
      .find({ trail, target }, { projection: ENTRY_FIELDS })
      .sort({ position: 1 })
      .toArray();
    return found.map(targetEntry);
  }

  async _extent({ trail }: { trail: string }): Promise<TrailExtentRecord> {
    const [entries, last] = await Promise.all([
      this.entries.countDocuments({ trail }),
      this.entries.findOne(
        { trail },
        { projection: { _id: 0, position: 1 }, sort: { position: -1 } },
      ),
    ]);
    return { entries, last: last?.position ?? 0 };
  }
}
