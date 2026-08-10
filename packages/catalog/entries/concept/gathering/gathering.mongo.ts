import type { Collection, Db, TransactionOptions } from "mongodb";
import {
  AlreadyJoined,
  ALREADY_JOINED_MESSAGE,
  GatheringNotFound,
  GATHERING_NOT_FOUND_MESSAGE,
  NotJoined,
  NOT_JOINED_MESSAGE,
  type GatheringRecord,
  type StoredGatheringRecord,
  type StoredMembershipRecord,
} from "./gathering.shared.ts";

const transactionOptions: TransactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

function duplicateMembership(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const pattern =
    "keyPattern" in error ? (error as { keyPattern?: unknown }).keyPattern : undefined;
  if (typeof pattern === "object" && pattern !== null) {
    const keys = Object.keys(pattern).sort();
    return keys.length === 2 && keys[0] === "gathering" && keys[1] === "member";
  }
  return error instanceof Error && error.message.includes("one_membership_per_person");
}

const indexes = new WeakMap<Db, Promise<void>>();
export function ensureGatheringIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = Promise.all([
      db
        .collection<StoredGatheringRecord>("gatherings")
        .createIndex({ gathering: 1 }, { name: "gathering_identity", unique: true }),
      db.collection<StoredMembershipRecord>("gathering_memberships").createIndexes([
        { key: { membership: 1 }, name: "membership_identity", unique: true },
        {
          key: { gathering: 1, member: 1 },
          name: "one_membership_per_person",
          unique: true,
        },
        {
          key: { gathering: 1, joinedOrder: 1 },
          name: "members_in_join_order",
          unique: true,
        },
      ]),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class GatheringMongoConcept {
  private readonly gatherings: Collection<StoredGatheringRecord>;
  private readonly memberships: Collection<StoredMembershipRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.gatherings = db.collection("gatherings");
    this.memberships = db.collection("gathering_memberships");
  }

  async create({ name, host }: { name: string; host: string }) {
    const gathering = this.freshID();
    const membership = this.freshID();
    await ensureGatheringIndexes(this.db);
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.gatherings.insertOne(
          { gathering, name, host, nextMembershipOrder: 1 },
          { session },
        );
        await this.memberships.insertOne(
          { membership, gathering, member: host, joinedOrder: 0 },
          { session },
        );
      }, transactionOptions);
    } finally {
      await session.endSession();
    }
    return { gathering };
  }

  async join({ gathering, member }: { gathering: string; member: string }) {
    await ensureGatheringIndexes(this.db);
    const membership = this.freshID();
    const session = this.db.client.startSession();
    try {
      await session.withTransaction(async () => {
        const found = await this.gatherings.findOneAndUpdate(
          { gathering },
          { $inc: { nextMembershipOrder: 1 } },
          { session, returnDocument: "before" },
        );
        if (found === null) throw new GatheringNotFound(GATHERING_NOT_FOUND_MESSAGE);
        await this.memberships.insertOne(
          {
            membership,
            gathering,
            member,
            joinedOrder: found.nextMembershipOrder,
          },
          { session },
        );
      }, transactionOptions);
    } catch (error) {
      if (duplicateMembership(error)) throw new AlreadyJoined(ALREADY_JOINED_MESSAGE);
      throw error;
    } finally {
      await session.endSession();
    }
    return { membership };
  }

  async leave({ gathering, member }: { gathering: string; member: string }) {
    await ensureGatheringIndexes(this.db);
    if ((await this.gatherings.countDocuments({ gathering }, { limit: 1 })) === 0)
      throw new GatheringNotFound(GATHERING_NOT_FOUND_MESSAGE);
    const found = await this.memberships.findOneAndDelete({ gathering, member });
    if (found === null) throw new NotJoined(NOT_JOINED_MESSAGE);
    return { membership: found.membership };
  }

  async _get({ gathering }: { gathering: string }): Promise<GatheringRecord[]> {
    const found = await this.gatherings.findOne(
      { gathering },
      { projection: { _id: 0, gathering: 1, name: 1, host: 1 } },
    );
    return found === null
      ? []
      : [{ gathering: found.gathering, name: found.name, host: found.host }];
  }

  async _members({ gathering }: { gathering: string }): Promise<{ member: string }[]> {
    return this.memberships
      .find({ gathering }, { projection: { _id: 0, member: 1 } })
      .sort({ joinedOrder: 1 })
      .toArray();
  }

  async _membership({ gathering, member }: { gathering: string; member: string }) {
    return {
      joined: (await this.memberships.countDocuments({ gathering, member }, { limit: 1 })) > 0,
    };
  }
}
