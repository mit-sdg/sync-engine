export class AlreadyUpvoted extends Error {}
export class AlreadyDownvoted extends Error {}
export class VoteNotFound extends Error {}

export type VoteDirection = "up" | "down";

export interface VoteRecord {
  item: string;
  voter: string;
  direction: VoteDirection;
}
