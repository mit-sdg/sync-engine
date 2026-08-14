import spec from "./spec.md" with { type: "text" };
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, view, where, whether } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Alerting, Approving, Timing } = concepts;

const OpenReviewAlert = view(
  "the open alert for (review) and (reviewer)",
  ({ review, reviewer }, { alert }, _bindings) =>
    where(
      Alerting._openFor({ recipient: reviewer }).is({
        alert,
        subject: review,
        cause: review,
      }),
    ),
).optional();

const QueuedAlert = former(
  "the queued alert for (review) and (reviewer)",
  ({ review, reviewer }, { alert }) =>
    where(OpenReviewAlert({ review, reviewer }).is({ alert })).form({ alert }),
).optional();

const ReviewQueue = former(
  "the review queue for (reviewer)",
  ({ reviewer }, { review, subject, requester, requestedAt }) =>
    form({
      reviews: each(
        Approving._pendingFor({ reviewer }).is({ review, subject, requester, requestedAt }),
      )
        .form({ review, subject, requester, requestedAt })
        .splicing(whether(QueuedAlert({ review, reviewer }))),
    }),
);

const PendingReviewForRepair = view(
  "the pending review to repair (review)",
  ({ review }, { reviewer, requestedAt }, _bindings) =>
    where(
      Approving._get({ review }).is({
        reviewer,
        status: "pending",
        requestedAt,
      }),
    ),
).optional();

const TerminalReviewForRepair = view(
  "the terminal review to repair (review)",
  ({ review }, { reviewer, requestedAt }, _bindings) => [
    where(Approving._get({ review }).is({ reviewer, status: "approved", requestedAt })),
    where(Approving._get({ review }).is({ reviewer, status: "rejected", requestedAt })),
    where(Approving._get({ review }).is({ reviewer, status: "withdrawn", requestedAt })),
  ],
).optional();

const RequestQueuedReview = endpoint(
  "/review-queue/request",
  ({ subject, requester, reviewer, time, review, alert }) =>
    receive({ subject, requester, reviewer })
      .where(Timing._now({}).is({ time }))
      .then(Approving.request({ subject, requester, reviewer, at: time }).responds({ review }))
      .then(
        Alerting.raise({
          recipient: reviewer,
          subject: review,
          cause: review,
          at: time,
        }).responds({ alert }),
      )
      .then(respond({ review, alert })),
);

const ApproveQueuedReview = endpoint("/review-queue/approve", ({ review, reviewer, time, alert }) =>
  receive({ review, reviewer })
    .where(Timing._now({}).is({ time }))
    .then(Approving.approve({ review, reviewer, at: time }).responds({ review }))
    .then(
      where(OpenReviewAlert({ review, reviewer }).is({ alert }))
        .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
        .then(respond({ review, alert }))
        .named("alert-open"),
      where(no(OpenReviewAlert({ review, reviewer })))
        .then(respond({ error: "REVIEW_ALERT_MISSING" }))
        .named("alert-missing"),
    ),
);

const RejectQueuedReview = endpoint(
  "/review-queue/reject",
  ({ review, reviewer, reason, time, alert }) =>
    receive({ review, reviewer, reason })
      .where(Timing._now({}).is({ time }))
      .then(Approving.reject({ review, reviewer, reason, at: time }).responds({ review }))
      .then(
        where(OpenReviewAlert({ review, reviewer }).is({ alert }))
          .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
          .then(respond({ review, alert }))
          .named("alert-open"),
        where(no(OpenReviewAlert({ review, reviewer })))
          .then(respond({ error: "REVIEW_ALERT_MISSING" }))
          .named("alert-missing"),
      ),
);

const WithdrawQueuedReview = endpoint(
  "/review-queue/withdraw",
  ({ review, requester, reviewer, time, alert }) =>
    receive({ review, requester })
      .where(Timing._now({}).is({ time }))
      .then(Approving.withdraw({ review, requester, at: time }).responds({ review }))
      .then(
        where(
          Approving._get({ review }).is({ reviewer }),
          OpenReviewAlert({ review, reviewer }).is({ alert }),
        )
          .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
          .then(respond({ review, alert }))
          .named("alert-open"),
        where(
          Approving._get({ review }).is({ reviewer }),
          no(OpenReviewAlert({ review, reviewer })),
        )
          .then(respond({ error: "REVIEW_ALERT_MISSING" }))
          .named("alert-missing"),
      ),
);

const RepairReviewAlert = endpoint(
  "/review-queue/repair",
  ({ review, reviewer, requestedAt, alert }) =>
    receive({ review }).then(
      where(PendingReviewForRepair({ review }).is({ reviewer, requestedAt }))
        .then(
          Alerting.raise({
            recipient: reviewer,
            subject: review,
            cause: review,
            at: requestedAt,
          }).responds({ alert }),
        )
        .then(respond({ review, alert }))
        .named("pending"),
      where(TerminalReviewForRepair({ review }).is({ reviewer, requestedAt }))
        .then(
          Alerting.raise({
            recipient: reviewer,
            subject: review,
            cause: review,
            at: requestedAt,
          }).responds({ alert }),
        )
        .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
        .then(respond({ review, alert }))
        .named("terminal"),
      where(no(Approving._get({ review })))
        .then(respond({ error: "REVIEW_NOT_FOUND" }))
        .named("missing"),
    ),
);

const GetReviewQueue = endpoint("/review-queue/get", ({ reviewer }) =>
  receive({ reviewer }).then(respond({ queue: ReviewQueue({ reviewer }) })),
);

export { spec };

export const compositions = {
  ReviewRequests: { RequestQueuedReview },
  ReviewDecisions: { ApproveQueuedReview, RejectQueuedReview, WithdrawQueuedReview },
  ReviewRepair: { RepairReviewAlert },
  ReviewQueues: { GetReviewQueue },
};
export const views = { OpenReviewAlert, PendingReviewForRepair, TerminalReviewForRepair };
export const formers = { QueuedAlert, ReviewQueue };
