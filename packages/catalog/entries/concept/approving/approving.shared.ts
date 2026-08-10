export class SelfReviewNotAllowed extends Error {}
export class ReviewAlreadyPending extends Error {}
export class ReviewNotPendingForReviewer extends Error {}
export class InvalidRejectionReason extends Error {}
export class ReviewNotPendingForRequester extends Error {}

export type ReviewStatus = "pending" | "approved" | "rejected" | "withdrawn";

export interface ReviewRecord {
  review: string;
  subject: string;
  requester: string;
  reviewer: string;
  status: ReviewStatus;
  requestedAt: Date;
  decidedAt?: Date;
  reason?: string;
}

export interface ReviewDetailsRecord {
  subject: string;
  requester: string;
  reviewer: string;
  status: ReviewStatus;
  requestedAt: Date;
  decidedAt: Date | undefined;
  reason: string | undefined;
}

export interface PendingReviewRecord {
  review: string;
  subject: string;
  requester: string;
  requestedAt: Date;
}

export interface ReviewHistoryRecord {
  review: string;
  requester: string;
  reviewer: string;
  status: ReviewStatus;
  requestedAt: Date;
  decidedAt: Date | undefined;
}
