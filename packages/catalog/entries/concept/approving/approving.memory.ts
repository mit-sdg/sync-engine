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
  type ReviewStatus,
} from "./approving.shared.ts";

function compareReviews(left: ReviewRecord, right: ReviewRecord): number {
  const byRequestedAt = left.requestedAt.getTime() - right.requestedAt.getTime();
  if (byRequestedAt !== 0) return byRequestedAt;
  return left.review < right.review ? -1 : left.review > right.review ? 1 : 0;
}

function details(record: ReviewRecord): ReviewDetailsRecord {
  return {
    subject: record.subject,
    requester: record.requester,
    reviewer: record.reviewer,
    status: record.status,
    requestedAt: new Date(record.requestedAt.getTime()),
    decidedAt: record.decidedAt === undefined ? undefined : new Date(record.decidedAt.getTime()),
    reason: record.reason,
  };
}

function pending(record: ReviewRecord): PendingReviewRecord {
  return {
    review: record.review,
    subject: record.subject,
    requester: record.requester,
    requestedAt: new Date(record.requestedAt.getTime()),
  };
}

function history(record: ReviewRecord): ReviewHistoryRecord {
  return {
    review: record.review,
    requester: record.requester,
    reviewer: record.reviewer,
    status: record.status,
    requestedAt: new Date(record.requestedAt.getTime()),
    decidedAt: record.decidedAt === undefined ? undefined : new Date(record.decidedAt.getTime()),
  };
}

export class ApprovingMemoryConcept {
  private readonly reviews = new Map<string, ReviewRecord>();
  private readonly pendingBySubject = new Map<string, string>();
  private readonly pendingByReviewer = new Map<string, Set<string>>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  request({
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
    if (this.pendingBySubject.has(subject))
      throw new ReviewAlreadyPending("This subject already has a pending review.");

    const review = this.freshID();
    if (this.reviews.has(review)) throw new Error("The Review identity is already in use.");
    const record: ReviewRecord = {
      review,
      subject,
      requester,
      reviewer,
      status: "pending",
      requestedAt: new Date(at.getTime()),
    };
    this.reviews.set(review, record);
    this.pendingBySubject.set(subject, review);
    const reviewerPending = this.pendingByReviewer.get(reviewer) ?? new Set<string>();
    reviewerPending.add(review);
    this.pendingByReviewer.set(reviewer, reviewerPending);
    return { review };
  }

  approve({ review, reviewer, at }: { review: string; reviewer: string; at: Date }) {
    const record = this.reviews.get(review);
    if (record === undefined || record.status !== "pending" || record.reviewer !== reviewer)
      throw new ReviewNotPendingForReviewer("There is no such pending review for this reviewer.");
    this.#complete(record, "approved", at);
    return { review };
  }

  reject({
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
    const record = this.reviews.get(review);
    if (record === undefined || record.status !== "pending" || record.reviewer !== reviewer)
      throw new ReviewNotPendingForReviewer("There is no such pending review for this reviewer.");
    this.#complete(record, "rejected", at, reason);
    return { review };
  }

  withdraw({ review, requester, at }: { review: string; requester: string; at: Date }) {
    const record = this.reviews.get(review);
    if (record === undefined || record.status !== "pending" || record.requester !== requester)
      throw new ReviewNotPendingForRequester("There is no such pending review for this requester.");
    this.#complete(record, "withdrawn", at);
    return { review };
  }

  _get({ review }: { review: string }): ReviewDetailsRecord[] {
    const record = this.reviews.get(review);
    return record === undefined ? [] : [details(record)];
  }

  _pendingFor({ reviewer }: { reviewer: string }): PendingReviewRecord[] {
    const ids = this.pendingByReviewer.get(reviewer);
    if (ids === undefined) return [];
    return [...ids]
      .map((review) => this.reviews.get(review))
      .filter((record): record is ReviewRecord => record !== undefined)
      .sort(compareReviews)
      .map(pending);
  }

  _history({ subject }: { subject: string }): ReviewHistoryRecord[] {
    return [...this.reviews.values()]
      .filter((record) => record.subject === subject)
      .sort(compareReviews)
      .map(history);
  }

  #complete(record: ReviewRecord, status: ReviewStatus, at: Date, reason?: string): void {
    record.status = status;
    record.decidedAt = new Date(at.getTime());
    if (reason === undefined) delete record.reason;
    else record.reason = reason;
    if (this.pendingBySubject.get(record.subject) === record.review)
      this.pendingBySubject.delete(record.subject);
    const reviewerPending = this.pendingByReviewer.get(record.reviewer);
    reviewerPending?.delete(record.review);
    if (reviewerPending?.size === 0) this.pendingByReviewer.delete(record.reviewer);
  }
}
