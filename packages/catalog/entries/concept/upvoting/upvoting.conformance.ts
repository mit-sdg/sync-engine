import { expect } from "vite-plus/test";
import {
  AlreadyDownvoted,
  AlreadyUpvoted,
  VoteNotFound,
  type VoteDirection,
} from "./upvoting.shared.ts";

type MaybePromise<Value> = Value | Promise<Value>;

export interface UpvotingImplementation {
  upvote(input: { item: string; voter: string }): MaybePromise<{ item: string; voter: string }>;
  downvote(input: { item: string; voter: string }): MaybePromise<{ item: string; voter: string }>;
  unvote(input: { item: string; voter: string }): MaybePromise<{ item: string; voter: string }>;
  _vote(input: { item: string; voter: string }): MaybePromise<{ direction: VoteDirection }[]>;
  _score(input: { item: string }): MaybePromise<{ score: number }>;
}

async function expectRefusal(
  action: () => MaybePromise<unknown>,
  errorClass: new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  let refusal: unknown;
  try {
    await action();
  } catch (error) {
    refusal = error;
  }
  expect(refusal).toBeInstanceOf(errorClass);
  expect(refusal).toMatchObject({ message });
}

export async function expectUpvotingConformance(upvoting: UpvotingImplementation): Promise<void> {
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: 0 });
  expect(await upvoting._vote({ item: "p1", voter: "Ari" })).toEqual([]);

  expect(await upvoting.upvote({ item: "p1", voter: "Ari" })).toEqual({
    item: "p1",
    voter: "Ari",
  });
  expect(await upvoting._vote({ item: "p1", voter: "Ari" })).toEqual([{ direction: "up" }]);
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: 1 });
  await expectRefusal(
    () => upvoting.upvote({ item: "p1", voter: "Ari" }),
    AlreadyUpvoted,
    "This voter has already upvoted the item.",
  );
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: 1 });

  expect(await upvoting.downvote({ item: "p1", voter: "Bo" })).toEqual({
    item: "p1",
    voter: "Bo",
  });
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: 0 });

  expect(await upvoting.downvote({ item: "p1", voter: "Ari" })).toEqual({
    item: "p1",
    voter: "Ari",
  });
  expect(await upvoting._vote({ item: "p1", voter: "Ari" })).toEqual([{ direction: "down" }]);
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: -2 });
  await expectRefusal(
    () => upvoting.downvote({ item: "p1", voter: "Ari" }),
    AlreadyDownvoted,
    "This voter has already downvoted the item.",
  );
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: -2 });

  expect(await upvoting.unvote({ item: "p1", voter: "Ari" })).toEqual({
    item: "p1",
    voter: "Ari",
  });
  expect(await upvoting._vote({ item: "p1", voter: "Ari" })).toEqual([]);
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: -1 });
  await expectRefusal(
    () => upvoting.unvote({ item: "p1", voter: "Ari" }),
    VoteNotFound,
    "This voter has no vote for the item.",
  );
  expect(await upvoting._score({ item: "p1" })).toEqual({ score: -1 });

  await upvoting.downvote({ item: "p2", voter: "Cy" });
  await upvoting.upvote({ item: "p2", voter: "Cy" });
  expect(await upvoting._vote({ item: "p2", voter: "Cy" })).toEqual([{ direction: "up" }]);
  expect(await upvoting._score({ item: "p2" })).toEqual({ score: 1 });
}
