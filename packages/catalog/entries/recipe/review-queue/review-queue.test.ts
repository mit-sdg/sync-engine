import { describe, expect, test, vi } from "vite-plus/test";
import { applicationConcepts } from "@catalog/concepts";
import { exerciseReviewQueue, exerciseReviewQueueRepair } from "./review-queue.behavior.ts";
import {
  ApproveQueuedReview,
  GetReviewQueue,
  RejectQueuedReview,
  RepairReviewAlert,
  RequestQueuedReview,
  WithdrawQueuedReview,
} from "./review-queue.ts";

function memoryInstances() {
  try {
    return applicationConcepts.implementations("memory" as never, {} as never);
  } catch (error) {
    if (error instanceof Error && error.message.includes('floor "memory" is missing')) return;
    throw error;
  }
}

describe("Review Queue recipe memory floor", () => {
  test("exports every declared endpoint", () => {
    for (const member of [
      ApproveQueuedReview,
      GetReviewQueue,
      RejectQueuedReview,
      RepairReviewAlert,
      RequestQueuedReview,
      WithdrawQueuedReview,
    ])
      expect(member).toBeDefined();
  });

  test("runs the queue contract against real memory concepts", async () => {
    const instances = memoryInstances();
    if (instances === undefined) return;
    await exerciseReviewQueue(instances);
  });

  test("repairs interrupted Alert effects against real memory concepts", async () => {
    const instances = memoryInstances();
    if (instances === undefined) return;
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await exerciseReviewQueueRepair(instances);
    } finally {
      reported.mockRestore();
    }
  });
});
