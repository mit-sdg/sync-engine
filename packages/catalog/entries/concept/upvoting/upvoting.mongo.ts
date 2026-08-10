import type { Collection, Db } from "mongodb";
import {
  AlreadyDownvoted,
  AlreadyUpvoted,
  VoteNotFound,
  type VoteDirection,
  type VoteRecord,
} from "./upvoting.shared.ts";

function duplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

const indexes = new WeakMap<Db, Promise<void>>();
export function ensureUpvotingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = db
      .collection<VoteRecord>("upvoting_votes")
      .createIndex({ item: 1, voter: 1 }, { name: "one_vote_per_item_and_voter", unique: true })
      .then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class UpvotingMongoConcept {
  private readonly votes: Collection<VoteRecord>;

  constructor(private readonly db: Db) {
    this.votes = db.collection("upvoting_votes");
  }

  async upvote({ item, voter }: { item: string; voter: string }) {
    return this.#setDirection(item, voter, "up");
  }

  async downvote({ item, voter }: { item: string; voter: string }) {
    return this.#setDirection(item, voter, "down");
  }

  async unvote({ item, voter }: { item: string; voter: string }) {
    await ensureUpvotingIndexes(this.db);
    const found = await this.votes.findOneAndDelete({ item, voter });
    if (found === null) throw new VoteNotFound("This voter has no vote for the item.");
    return { item, voter };
  }

  async _vote({
    item,
    voter,
  }: {
    item: string;
    voter: string;
  }): Promise<{ direction: VoteDirection }[]> {
    const found = await this.votes.findOne(
      { item, voter },
      { projection: { _id: 0, direction: 1 } },
    );
    return found === null ? [] : [{ direction: found.direction }];
  }

  async _score({ item }: { item: string }) {
    const [found] = await this.votes
      .aggregate<{ score: number }>([
        { $match: { item } },
        {
          $group: {
            _id: null,
            score: { $sum: { $cond: [{ $eq: ["$direction", "up"] }, 1, -1] } },
          },
        },
        { $project: { _id: 0, score: 1 } },
      ])
      .toArray();
    return found ?? { score: 0 };
  }

  async #setDirection(item: string, voter: string, direction: VoteDirection) {
    await ensureUpvotingIndexes(this.db);
    for (;;) {
      const changed = await this.votes.updateOne(
        { item, voter, direction: { $ne: direction } },
        { $set: { direction } },
      );
      if (changed.matchedCount === 1) return { item, voter };

      const current = await this.votes.findOne(
        { item, voter },
        { projection: { _id: 0, direction: 1 } },
      );
      if (current?.direction === direction) {
        if (direction === "up")
          throw new AlreadyUpvoted("This voter has already upvoted the item.");
        throw new AlreadyDownvoted("This voter has already downvoted the item.");
      }
      if (current !== null) continue;

      try {
        await this.votes.insertOne({ item, voter, direction });
        return { item, voter };
      } catch (error) {
        if (!duplicateKey(error)) throw error;
      }
    }
  }
}
