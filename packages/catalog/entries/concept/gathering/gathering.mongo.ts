import type { Collection, Db } from "mongodb";
import {
  AlreadyJoined,
  GatheringNotFound,
  NotJoined,
  type GatheringRecord,
  type MembershipRecord,
} from "./gathering.shared.ts";

function duplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
const indexes = new WeakMap<Db, Promise<void>>();
export function ensureGatheringIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = db
      .collection<MembershipRecord>("gathering_memberships")
      .createIndex({ gathering: 1, member: 1 }, { unique: true })
      .then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}
export class GatheringMongoConcept {
  private readonly gatherings: Collection<GatheringRecord>;
  private readonly memberships: Collection<MembershipRecord>;
  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.gatherings = db.collection("gatherings");
    this.memberships = db.collection("gathering_memberships");
  }
  async create({ name, host }: { name: string; host: string }) {
    await ensureGatheringIndexes(this.db);
    const gathering = this.freshID();
    await this.gatherings.insertOne({ gathering, name, host });
    await this.memberships.insertOne({ membership: this.freshID(), gathering, member: host });
    return { gathering };
  }
  async join({ gathering, member }: { gathering: string; member: string }) {
    await ensureGatheringIndexes(this.db);
    if ((await this.gatherings.countDocuments({ gathering }, { limit: 1 })) === 0)
      throw new GatheringNotFound("There is no such gathering.");
    const membership = this.freshID();
    try {
      await this.memberships.insertOne({ membership, gathering, member });
    } catch (error) {
      if (duplicate(error))
        throw new AlreadyJoined("This person already belongs to the gathering.");
      throw error;
    }
    return { membership };
  }
  async leave({ gathering, member }: { gathering: string; member: string }) {
    await ensureGatheringIndexes(this.db);
    if ((await this.gatherings.countDocuments({ gathering }, { limit: 1 })) === 0)
      throw new GatheringNotFound("There is no such gathering.");
    const found = await this.memberships.findOneAndDelete({ gathering, member });
    if (found === null) throw new NotJoined("This person does not belong to the gathering.");
    return { membership: found.membership };
  }
  async _get({ gathering }: { gathering: string }): Promise<GatheringRecord[]> {
    const found = await this.gatherings.findOne({ gathering }, { projection: { _id: 0 } });
    return found === null ? [] : [found];
  }
  async _members({ gathering }: { gathering: string }): Promise<{ member: string }[]> {
    return this.memberships
      .find({ gathering }, { projection: { _id: 0, member: 1 } })
      .sort({ _id: 1 })
      .toArray();
  }
  async _membership({ gathering, member }: { gathering: string; member: string }) {
    return {
      joined: (await this.memberships.countDocuments({ gathering, member }, { limit: 1 })) > 0,
    };
  }
}
