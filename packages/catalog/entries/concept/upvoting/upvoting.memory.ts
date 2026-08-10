import {
  AlreadyDownvoted,
  AlreadyUpvoted,
  VoteNotFound,
  type VoteDirection,
} from "./upvoting.shared.ts";

export class UpvotingMemoryConcept {
  private readonly votes = new Map<string, Map<string, VoteDirection>>();

  upvote({ item, voter }: { item: string; voter: string }) {
    return this.#setDirection(item, voter, "up");
  }

  downvote({ item, voter }: { item: string; voter: string }) {
    return this.#setDirection(item, voter, "down");
  }

  unvote({ item, voter }: { item: string; voter: string }) {
    const votesForItem = this.votes.get(item);
    if (votesForItem?.delete(voter) !== true)
      throw new VoteNotFound("This voter has no vote for the item.");
    if (votesForItem.size === 0) this.votes.delete(item);
    return { item, voter };
  }

  _vote({ item, voter }: { item: string; voter: string }): { direction: VoteDirection }[] {
    const direction = this.votes.get(item)?.get(voter);
    return direction === undefined ? [] : [{ direction }];
  }

  _score({ item }: { item: string }) {
    let score = 0;
    for (const direction of this.votes.get(item)?.values() ?? [])
      score += direction === "up" ? 1 : -1;
    return { score };
  }

  #setDirection(item: string, voter: string, direction: VoteDirection) {
    let votesForItem = this.votes.get(item);
    const current = votesForItem?.get(voter);
    if (current === direction) {
      if (direction === "up") throw new AlreadyUpvoted("This voter has already upvoted the item.");
      throw new AlreadyDownvoted("This voter has already downvoted the item.");
    }
    if (votesForItem === undefined) {
      votesForItem = new Map();
      this.votes.set(item, votesForItem);
    }
    votesForItem.set(voter, direction);
    return { item, voter };
  }
}
