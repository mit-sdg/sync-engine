import { assemble } from "@mit-sdg/sync-engine/assembly";
import { expect } from "vite-plus/test";
import { applicationConcepts, vocabulary } from "@catalog/concepts";
import {
  ApproveQueuedReview,
  GetReviewQueue,
  RejectQueuedReview,
  RepairReviewAlert,
  RequestQueuedReview,
  WithdrawQueuedReview,
} from "./review-queue.ts";

export type CatalogInstances = ReturnType<typeof applicationConcepts.implementations>;

type ReviewQueueApplication = ReturnType<typeof assembleReviewQueue>;

const composition = {
  ApproveQueuedReview,
  GetReviewQueue,
  RejectQueuedReview,
  RepairReviewAlert,
  RequestQueuedReview,
  WithdrawQueuedReview,
};

export function assembleReviewQueue(instances: CatalogInstances) {
  return assemble({ vocabulary, instances, composition, queryCache: "none" });
}

async function invoke(
  application: ReviewQueueApplication,
  path: string,
  input: Record<string, unknown>,
) {
  return application.invoker.invoke(path as never, input as never);
}

async function success(
  application: ReviewQueueApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await invoke(application, path, input);
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(`Expected ${path} to succeed.`);
  return result.value as Record<string, unknown>;
}

function observedTiming(instances: CatalogInstances) {
  const delegate = instances.Timing;
  const observed: Date[] = [];
  return {
    observed,
    timing: {
      async _now() {
        const answer = await delegate._now();
        observed.push(new Date(answer.time.getTime()));
        return answer;
      },
    } as CatalogInstances["Timing"],
  };
}

function expectIdentity(value: unknown): string {
  expect(value).toEqual(expect.any(String));
  return value as string;
}

export async function exerciseReviewQueue(instances: CatalogInstances): Promise<void> {
  const { observed, timing } = observedTiming(instances);
  const application = assembleReviewQueue({ ...instances, Timing: timing });

  const beforeRequest = observed.length;
  const requested = await success(application, "/review-queue/request", {
    subject: "change-7",
    requester: "Ari",
    reviewer: "Bo",
  });
  expect(observed).toHaveLength(beforeRequest + 1);
  const review = expectIdentity(requested.review);
  const alert = expectIdentity(requested.alert);

  const [reviewRecord] = await instances.Approving._get({ review });
  const [alertRecord] = await instances.Alerting._get({ alert });
  expect(reviewRecord).toMatchObject({
    subject: "change-7",
    requester: "Ari",
    reviewer: "Bo",
    status: "pending",
  });
  expect(alertRecord).toMatchObject({
    recipient: "Bo",
    subject: review,
    cause: review,
    open: true,
  });
  expect(reviewRecord?.requestedAt).toEqual(observed[beforeRequest]);
  expect(alertRecord?.raisedAt).toEqual(observed[beforeRequest]);

  await expect(invoke(application, "/review-queue/get", { reviewer: "Bo" })).resolves.toEqual({
    ok: true,
    value: {
      queue: {
        reviews: [
          {
            review,
            subject: "change-7",
            requester: "Ari",
            requestedAt: reviewRecord?.requestedAt,
            alert,
          },
        ],
      },
    },
  });

  await expect(
    invoke(application, "/review-queue/request", {
      subject: "change-7",
      requester: "Cy",
      reviewer: "Bo",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "REVIEW_ALREADY_PENDING" },
  });
  await expect(
    invoke(application, "/review-queue/approve", { review, reviewer: "Ari" }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "REVIEW_NOT_PENDING_FOR_REVIEWER" },
  });

  const beforeDecision = observed.length;
  await expect(
    invoke(application, "/review-queue/approve", { review, reviewer: "Bo" }),
  ).resolves.toEqual({ ok: true, value: { review, alert } });
  expect(observed).toHaveLength(beforeDecision + 1);
  expect((await instances.Approving._get({ review }))[0]).toMatchObject({
    status: "approved",
    decidedAt: observed[beforeDecision],
  });
  expect((await instances.Alerting._get({ alert }))[0]).toMatchObject({ open: false });
  await expect(invoke(application, "/review-queue/get", { reviewer: "Bo" })).resolves.toEqual({
    ok: true,
    value: { queue: { reviews: [] } },
  });

  const rejectedRequest = await success(application, "/review-queue/request", {
    subject: "change-7",
    requester: "Ari",
    reviewer: "Bo",
  });
  const rejectedReview = expectIdentity(rejectedRequest.review);
  const rejectedAlert = expectIdentity(rejectedRequest.alert);
  await expect(
    invoke(application, "/review-queue/reject", {
      review: rejectedReview,
      reviewer: "Bo",
      reason: "Tests are missing.",
    }),
  ).resolves.toEqual({
    ok: true,
    value: { review: rejectedReview, alert: rejectedAlert },
  });
  expect((await instances.Approving._get({ review: rejectedReview }))[0]).toMatchObject({
    status: "rejected",
    reason: "Tests are missing.",
  });
  expect((await instances.Alerting._get({ alert: rejectedAlert }))[0]).toMatchObject({
    open: false,
  });

  const withdrawnRequest = await success(application, "/review-queue/request", {
    subject: "change-8",
    requester: "Ari",
    reviewer: "Bo",
  });
  const withdrawnReview = expectIdentity(withdrawnRequest.review);
  const withdrawnAlert = expectIdentity(withdrawnRequest.alert);
  await expect(
    invoke(application, "/review-queue/withdraw", {
      review: withdrawnReview,
      requester: "Ari",
    }),
  ).resolves.toEqual({
    ok: true,
    value: { review: withdrawnReview, alert: withdrawnAlert },
  });
  expect((await instances.Approving._get({ review: withdrawnReview }))[0]).toMatchObject({
    status: "withdrawn",
  });
  expect((await instances.Alerting._get({ alert: withdrawnAlert }))[0]).toMatchObject({
    open: false,
  });

  await expect(
    invoke(application, "/review-queue/repair", { review: "unknown-review" }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "REVIEW_NOT_FOUND" },
  });
}

export async function exerciseReviewQueueRepair(instances: CatalogInstances): Promise<void> {
  const { observed, timing } = observedTiming(instances);
  const delegate = instances.Alerting;
  let failNextRaise = true;
  let failNextAcknowledge = false;
  const interruptedAlerting = {
    raise(input: Parameters<CatalogInstances["Alerting"]["raise"]>[0]) {
      if (failNextRaise) {
        failNextRaise = false;
        throw new Error("injected alert raise fault");
      }
      return delegate.raise(input);
    },
    acknowledge(input: Parameters<CatalogInstances["Alerting"]["acknowledge"]>[0]) {
      if (failNextAcknowledge) {
        failNextAcknowledge = false;
        throw new Error("injected alert acknowledgement fault");
      }
      return delegate.acknowledge(input);
    },
    _openFor: delegate._openFor.bind(delegate),
    _get: delegate._get.bind(delegate),
  } as CatalogInstances["Alerting"];
  const application = assembleReviewQueue({
    ...instances,
    Alerting: interruptedAlerting,
    Timing: timing,
  });

  await expect(
    invoke(application, "/review-queue/request", {
      subject: "partial-pending",
      requester: "Ari",
      reviewer: "Bo",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "framework", code: "INTERNAL_ERROR" },
  });
  const [pending] = await instances.Approving._pendingFor({ reviewer: "Bo" });
  if (pending === undefined) throw new Error("The interrupted Review was not retained.");
  expect(await instances.Alerting._openFor({ recipient: "Bo" })).toEqual([]);
  await expect(invoke(application, "/review-queue/get", { reviewer: "Bo" })).resolves.toEqual({
    ok: true,
    value: {
      queue: {
        reviews: [
          {
            review: pending.review,
            subject: "partial-pending",
            requester: "Ari",
            requestedAt: pending.requestedAt,
            alert: null,
          },
        ],
      },
    },
  });

  const repairedPending = await success(application, "/review-queue/repair", {
    review: pending.review,
  });
  const pendingAlert = expectIdentity(repairedPending.alert);
  expect((await instances.Alerting._get({ alert: pendingAlert }))[0]).toMatchObject({
    recipient: "Bo",
    subject: pending.review,
    cause: pending.review,
    raisedAt: pending.requestedAt,
    open: true,
  });

  failNextAcknowledge = true;
  await expect(
    invoke(application, "/review-queue/approve", {
      review: pending.review,
      reviewer: "Bo",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "framework", code: "INTERNAL_ERROR" },
  });
  expect((await instances.Approving._get({ review: pending.review }))[0]).toMatchObject({
    status: "approved",
  });
  expect((await instances.Alerting._get({ alert: pendingAlert }))[0]).toMatchObject({ open: true });
  await expect(
    invoke(application, "/review-queue/repair", { review: pending.review }),
  ).resolves.toEqual({
    ok: true,
    value: { review: pending.review, alert: pendingAlert },
  });
  expect((await instances.Alerting._get({ alert: pendingAlert }))[0]).toMatchObject({
    open: false,
  });

  failNextRaise = true;
  await expect(
    invoke(application, "/review-queue/request", {
      subject: "partial-terminal",
      requester: "Cy",
      reviewer: "Di",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "framework", code: "INTERNAL_ERROR" },
  });
  const [terminalMissing] = await instances.Approving._pendingFor({ reviewer: "Di" });
  if (terminalMissing === undefined) throw new Error("The second interrupted Review was lost.");
  await expect(
    invoke(application, "/review-queue/approve", {
      review: terminalMissing.review,
      reviewer: "Di",
    }),
  ).resolves.toEqual({
    ok: false,
    error: { kind: "domain", value: "REVIEW_ALERT_MISSING" },
  });
  expect((await instances.Approving._get({ review: terminalMissing.review }))[0]).toMatchObject({
    status: "approved",
  });
  const repairedTerminal = await success(application, "/review-queue/repair", {
    review: terminalMissing.review,
  });
  const terminalAlert = expectIdentity(repairedTerminal.alert);
  expect((await instances.Alerting._get({ alert: terminalAlert }))[0]).toMatchObject({
    recipient: "Di",
    subject: terminalMissing.review,
    cause: terminalMissing.review,
    raisedAt: terminalMissing.requestedAt,
    open: false,
  });

  expect(observed).toHaveLength(4);
}
