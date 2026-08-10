import type { Collection, Db } from "mongodb";
import {
  InvalidRejectionReason,
  ReviewAlreadyPending,
  ReviewNotPendingForRequester,
  ReviewNotPendingForReviewer,
  SelfReviewNotAllowed,
  type PendingReviewRecord,
  type ReviewDetailsRecord,
  type ReviewHistoryRecord,
  type ReviewRecord,
} from "./approving.shared.ts";

const PENDING_SUBJECT_INDEX = "approving_one_pending_review_per_subject";

function pendingSubjectDuplicate(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const keyPattern =
    "keyPattern" in error ? (error as { keyPattern?: unknown }).keyPattern : undefined;
  if (
    typeof keyPattern === "object" &&
    keyPattern !== null &&
    "subject" in keyPattern &&
    (keyPattern as { subject?: unknown }).subject === 1
  )
    return true;
  return error instanceof Error && error.message.includes(PENDING_SUBJECT_INDEX);
}

function details(record: ReviewRecord): ReviewDetailsRecord {
  return {
    subject: record.subject,
    requester: record.requester,
    reviewer: record.reviewer,
    status: record.status,
    requestedAt: record.requestedAt,
    decidedAt: record.decidedAt,
    reason: record.reason,
  };
}

function pending(record: ReviewRecord): PendingReviewRecord {
  return {
    review: record.review,
    subject: record.subject,
    requester: record.requester,
    requestedAt: record.requestedAt,
  };
}

function history(record: ReviewRecord): ReviewHistoryRecord {
  return {
    review: record.review,
    requester: record.requester,
    reviewer: record.reviewer,
    status: record.status,
    requestedAt: record.requestedAt,
    decidedAt: record.decidedAt,
  };
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureApprovingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const reviews = db.collection<ReviewRecord>("approving_reviews");
    ready = Promise.all([
      reviews.createIndex({ review: 1 }, { name: "approving_unique_review", unique: true }),
      reviews.createIndex(
        { subject: 1 },
        {
          name: PENDING_SUBJECT_INDEX,
          unique: true,
          partialFilterExpression: { status: "pending" },
        },
      ),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class ApprovingMongoConcept {
  private readonly reviews: Collection<ReviewRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.reviews = db.collection("approving_reviews");
  }

  async request({
    subject,
    requester,
    reviewer,
    at,
  }: {
    subject: string;
    requester: string;
    reviewer: string;
    at: Date;
  }) {
    if (requester === reviewer)
      throw new SelfReviewNotAllowed("A requester cannot review the same request.");
    await ensureApprovingIndexes(this.db);
    const review = this.freshID();
    try {
      await this.reviews.insertOne({
        review,
        subject,
        requester,
        reviewer,
        status: "pending",
        requestedAt: new Date(at.getTime()),
      });
    } catch (error) {
      if (pendingSubjectDuplicate(error))
        throw new ReviewAlreadyPending("This subject already has a pending review.");
      throw error;
    }
    return { review };
  }

  async approve({ review, reviewer, at }: { review: string; reviewer: string; at: Date }) {
    await ensureApprovingIndexes(this.db);
    const found = await this.reviews.findOneAndUpdate(
      { review, reviewer, status: "pending" },
      {
        $set: { status: "approved", decidedAt: new Date(at.getTime()) },
        $unset: { reason: "" },
      },
    );
    if (found === null)
      throw new ReviewNotPendingForReviewer("There is no such pending review for this reviewer.");
    return { review };
  }

  async reject({
    review,
    reviewer,
    reason,
    at,
  }: {
    review: string;
    reviewer: string;
    reason: string;
    at: Date;
  }) {
    if (reason.trim().length === 0 || reason.length > 500)
      throw new InvalidRejectionReason(
        "A rejection reason must not be blank and must be at most 500 characters.",
      );
    await ensureApprovingIndexes(this.db);
    const found = await this.reviews.findOneAndUpdate(
      { review, reviewer, status: "pending" },
      { $set: { status: "rejected", reason, decidedAt: new Date(at.getTime()) } },
    );
    if (found === null)
      throw new ReviewNotPendingForReviewer("There is no such pending review for this reviewer.");
    return { review };
  }

  async withdraw({ review, requester, at }: { review: string; requester: string; at: Date }) {
    await ensureApprovingIndexes(this.db);
    const found = await this.reviews.findOneAndUpdate(
      { review, requester, status: "pending" },
      {
        $set: { status: "withdrawn", decidedAt: new Date(at.getTime()) },
        $unset: { reason: "" },
      },
    );
    if (found === null)
      throw new ReviewNotPendingForRequester("There is no such pending review for this requester.");
    return { review };
  }

  async _get({ review }: { review: string }): Promise<ReviewDetailsRecord[]> {
    const found = await this.reviews.findOne({ review }, { projection: { _id: 0 } });
    return found === null ? [] : [details(found)];
  }

  async _pendingFor({ reviewer }: { reviewer: string }): Promise<PendingReviewRecord[]> {
    const found = await this.reviews
      .find({ reviewer, status: "pending" }, { projection: { _id: 0 } })
      .sort({ requestedAt: 1, review: 1 })
      .toArray();
    return found.map(pending);
  }

  async _history({ subject }: { subject: string }): Promise<ReviewHistoryRecord[]> {
    const found = await this.reviews
      .find({ subject }, { projection: { _id: 0 } })
      .sort({ requestedAt: 1, review: 1 })
      .toArray();
    return found.map(history);
  }
}
