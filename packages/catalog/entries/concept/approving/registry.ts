import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  InvalidRejectionReason,
  ReviewAlreadyPending,
  ReviewNotPendingForRequester,
  ReviewNotPendingForReviewer,
  SelfReviewNotAllowed,
} from "./approving.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { ApprovingMemoryConcept } from "./approving.memory.ts";
//#endfloor

//#class memory ApprovingMemoryConcept
export const approving = registerConcept({
  class: ApprovingMemoryConcept, // selected-class
  spec,
  refusals: {
    SELF_REVIEW_NOT_ALLOWED: SelfReviewNotAllowed,
    REVIEW_ALREADY_PENDING: ReviewAlreadyPending,
    REVIEW_NOT_PENDING_FOR_REVIEWER: ReviewNotPendingForReviewer,
    INVALID_REJECTION_REASON: InvalidRejectionReason,
    REVIEW_NOT_PENDING_FOR_REQUESTER: ReviewNotPendingForRequester,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new ApprovingMemoryConcept(),
    //#endfloor
  },
});
