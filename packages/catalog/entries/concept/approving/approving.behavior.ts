import { expect } from "vite-plus/test";
import {
  InvalidRejectionReason,
  ReviewAlreadyPending,
  ReviewNotPendingForRequester,
  ReviewNotPendingForReviewer,
  SelfReviewNotAllowed,
  type PendingReviewRecord,
  type ReviewDetailsRecord,
  type ReviewHistoryRecord,
} from "./approving.shared.ts";

type MaybePromise<T> = T | Promise<T>;

export interface ApprovingBehavior {
  request(input: {
    subject: string;
    requester: string;
    reviewer: string;
    at: Date;
  }): MaybePromise<{ review: string }>;
  approve(input: { review: string; reviewer: string; at: Date }): MaybePromise<{ review: string }>;
  reject(input: {
    review: string;
    reviewer: string;
    reason: string;
    at: Date;
  }): MaybePromise<{ review: string }>;
  withdraw(input: {
    review: string;
    requester: string;
    at: Date;
  }): MaybePromise<{ review: string }>;
  _get(input: { review: string }): MaybePromise<ReviewDetailsRecord[]>;
  _pendingFor(input: { reviewer: string }): MaybePromise<PendingReviewRecord[]>;
  _history(input: { subject: string }): MaybePromise<ReviewHistoryRecord[]>;
}

export function identities(...values: string[]): () => string {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error("No deterministic Review identity remains.");
    return value;
  };
}

function byReview(left: { readonly review: string }, right: { readonly review: string }): number {
  return left.review < right.review ? -1 : left.review > right.review ? 1 : 0;
}

async function expectRefusal(
  action: () => MaybePromise<unknown>,
  refusal: abstract new (...args: never[]) => Error,
  detail: string,
): Promise<void> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(refusal);
  expect(caught).toHaveProperty("message", detail);
}

export async function exerciseApprovingBehavior(approving: ApprovingBehavior): Promise<void> {
  const requestedAt = new Date("2025-01-01T09:00:00.000Z");
  const decidedAt = new Date("2025-01-01T10:00:00.000Z");
  const requestedAgainAt = new Date("2025-01-02T09:00:00.000Z");

  expect(await approving._get({ review: "unknown" })).toEqual([]);
  expect(await approving._pendingFor({ reviewer: "unknown" })).toEqual([]);
  expect(await approving._history({ subject: "unknown" })).toEqual([]);

  await expectRefusal(
    () =>
      approving.request({
        subject: "self-review",
        requester: "Ari",
        reviewer: "Ari",
        at: requestedAt,
      }),
    SelfReviewNotAllowed,
    "A requester cannot review the same request.",
  );
  expect(await approving._history({ subject: "self-review" })).toEqual([]);

  const first = await approving.request({
    subject: "change-7",
    requester: "Ari",
    reviewer: "Bo",
    at: requestedAt,
  });
  expect(await approving._get(first)).toEqual([
    {
      subject: "change-7",
      requester: "Ari",
      reviewer: "Bo",
      status: "pending",
      requestedAt,
      decidedAt: undefined,
      reason: undefined,
    },
  ]);
  expect(await approving._pendingFor({ reviewer: "Bo" })).toEqual([
    { review: first.review, subject: "change-7", requester: "Ari", requestedAt },
  ]);

  await expectRefusal(
    () =>
      approving.request({
        subject: "change-7",
        requester: "Cy",
        reviewer: "Dia",
        at: requestedAgainAt,
      }),
    ReviewAlreadyPending,
    "This subject already has a pending review.",
  );
  expect(await approving._history({ subject: "change-7" })).toHaveLength(1);

  await expectRefusal(
    () => approving.approve({ review: first.review, reviewer: "Ari", at: decidedAt }),
    ReviewNotPendingForReviewer,
    "There is no such pending review for this reviewer.",
  );
  expect(await approving._get(first)).toHaveProperty("0.status", "pending");

  expect(await approving.approve({ review: first.review, reviewer: "Bo", at: decidedAt })).toEqual(
    first,
  );
  expect(await approving._get(first)).toEqual([
    {
      subject: "change-7",
      requester: "Ari",
      reviewer: "Bo",
      status: "approved",
      requestedAt,
      decidedAt,
      reason: undefined,
    },
  ]);
  expect(await approving._pendingFor({ reviewer: "Bo" })).toEqual([]);

  await expectRefusal(
    () =>
      approving.reject({
        review: first.review,
        reviewer: "Bo",
        reason: "Changed my mind",
        at: decidedAt,
      }),
    ReviewNotPendingForReviewer,
    "There is no such pending review for this reviewer.",
  );
  await expectRefusal(
    () => approving.withdraw({ review: first.review, requester: "Ari", at: decidedAt }),
    ReviewNotPendingForRequester,
    "There is no such pending review for this requester.",
  );

  const second = await approving.request({
    subject: "change-7",
    requester: "Ari",
    reviewer: "Bo",
    at: requestedAgainAt,
  });
  expect(await approving._history({ subject: "change-7" })).toEqual([
    {
      review: first.review,
      requester: "Ari",
      reviewer: "Bo",
      status: "approved",
      requestedAt,
      decidedAt,
    },
    {
      review: second.review,
      requester: "Ari",
      reviewer: "Bo",
      status: "pending",
      requestedAt: requestedAgainAt,
      decidedAt: undefined,
    },
  ]);
  const sameTimePending = await approving.request({
    subject: "change-8",
    requester: "Cy",
    reviewer: "Bo",
    at: requestedAgainAt,
  });
  expect(await approving._pendingFor({ reviewer: "Bo" })).toEqual(
    [
      {
        review: second.review,
        subject: "change-7",
        requester: "Ari",
        requestedAt: requestedAgainAt,
      },
      {
        review: sameTimePending.review,
        subject: "change-8",
        requester: "Cy",
        requestedAt: requestedAgainAt,
      },
    ].sort(byReview),
  );

  const rejectionRequestedAt = new Date("2025-01-03T09:00:00.000Z");
  const rejectionDecidedAt = new Date("2025-01-03T10:00:00.000Z");
  const rejected = await approving.request({
    subject: "change-rejected",
    requester: "Cy",
    reviewer: "Dia",
    at: rejectionRequestedAt,
  });
  await expectRefusal(
    () =>
      approving.reject({
        review: rejected.review,
        reviewer: "Dia",
        reason: "   ",
        at: rejectionDecidedAt,
      }),
    InvalidRejectionReason,
    "A rejection reason must not be blank and must be at most 500 characters.",
  );
  await expectRefusal(
    () =>
      approving.reject({
        review: rejected.review,
        reviewer: "Dia",
        reason: "x".repeat(501),
        at: rejectionDecidedAt,
      }),
    InvalidRejectionReason,
    "A rejection reason must not be blank and must be at most 500 characters.",
  );
  await expectRefusal(
    () =>
      approving.reject({
        review: rejected.review,
        reviewer: "Eli",
        reason: "The change needs evidence.",
        at: rejectionDecidedAt,
      }),
    ReviewNotPendingForReviewer,
    "There is no such pending review for this reviewer.",
  );
  expect(await approving._get(rejected)).toHaveProperty("0.status", "pending");
  expect(
    await approving.reject({
      review: rejected.review,
      reviewer: "Dia",
      reason: "The change needs evidence.",
      at: rejectionDecidedAt,
    }),
  ).toEqual(rejected);
  expect(await approving._get(rejected)).toEqual([
    {
      subject: "change-rejected",
      requester: "Cy",
      reviewer: "Dia",
      status: "rejected",
      requestedAt: rejectionRequestedAt,
      decidedAt: rejectionDecidedAt,
      reason: "The change needs evidence.",
    },
  ]);

  const withdrawalRequestedAt = new Date("2025-01-04T09:00:00.000Z");
  const withdrawalDecidedAt = new Date("2025-01-04T10:00:00.000Z");
  const withdrawn = await approving.request({
    subject: "change-withdrawn",
    requester: "Eli",
    reviewer: "Fay",
    at: withdrawalRequestedAt,
  });
  await expectRefusal(
    () =>
      approving.withdraw({ review: withdrawn.review, requester: "Cy", at: withdrawalDecidedAt }),
    ReviewNotPendingForRequester,
    "There is no such pending review for this requester.",
  );
  expect(
    await approving.withdraw({
      review: withdrawn.review,
      requester: "Eli",
      at: withdrawalDecidedAt,
    }),
  ).toEqual(withdrawn);
  expect(await approving._get(withdrawn)).toEqual([
    {
      subject: "change-withdrawn",
      requester: "Eli",
      reviewer: "Fay",
      status: "withdrawn",
      requestedAt: withdrawalRequestedAt,
      decidedAt: withdrawalDecidedAt,
      reason: undefined,
    },
  ]);

  const tiedRequestedAt = new Date("2025-01-05T09:00:00.000Z");
  const tiedDecidedAt = new Date("2025-01-05T10:00:00.000Z");
  const firstTied = await approving.request({
    subject: "change-history-order",
    requester: "Gus",
    reviewer: "Hana",
    at: tiedRequestedAt,
  });
  await approving.approve({ review: firstTied.review, reviewer: "Hana", at: tiedDecidedAt });
  const secondTied = await approving.request({
    subject: "change-history-order",
    requester: "Gus",
    reviewer: "Hana",
    at: tiedRequestedAt,
  });
  expect(await approving._history({ subject: "change-history-order" })).toEqual(
    [
      {
        review: firstTied.review,
        requester: "Gus",
        reviewer: "Hana",
        status: "approved",
        requestedAt: tiedRequestedAt,
        decidedAt: tiedDecidedAt,
      },
      {
        review: secondTied.review,
        requester: "Gus",
        reviewer: "Hana",
        status: "pending",
        requestedAt: tiedRequestedAt,
        decidedAt: undefined,
      },
    ].sort(byReview),
  );

  await expectRefusal(
    () => approving.approve({ review: "unknown", reviewer: "Bo", at: decidedAt }),
    ReviewNotPendingForReviewer,
    "There is no such pending review for this reviewer.",
  );
  await expectRefusal(
    () =>
      approving.reject({
        review: "unknown",
        reviewer: "Bo",
        reason: "No matching review.",
        at: decidedAt,
      }),
    ReviewNotPendingForReviewer,
    "There is no such pending review for this reviewer.",
  );
  await expectRefusal(
    () => approving.withdraw({ review: "unknown", requester: "Ari", at: decidedAt }),
    ReviewNotPendingForRequester,
    "There is no such pending review for this requester.",
  );
}
