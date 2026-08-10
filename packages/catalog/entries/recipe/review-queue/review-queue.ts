import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, form, former, no, view, where, whether } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Alerting, Approving, Timing } = concepts;

const openReviewAlert = view(
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

const queuedAlert = former(
  "the queued alert for (review) and (reviewer)",
  ({ review, reviewer }, { alert }) =>
    where(openReviewAlert({ review, reviewer }).is({ alert })).form({ alert }),
).optional();

const reviewQueue = former(
  "the review queue for (reviewer)",
  ({ reviewer }, { review, subject, requester, requestedAt }) =>
    form({
      reviews: each(
        Approving._pendingFor({ reviewer }).is({ review, subject, requester, requestedAt }),
      )
        .form({ review, subject, requester, requestedAt })
        .splicing(whether(queuedAlert({ review, reviewer }))),
    }),
);

const pendingReviewForRepair = view(
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

const terminalReviewForRepair = view(
  "the terminal review to repair (review)",
  ({ review }, { reviewer, requestedAt }, _bindings) => [
    where(Approving._get({ review }).is({ reviewer, status: "approved", requestedAt })),
    where(Approving._get({ review }).is({ reviewer, status: "rejected", requestedAt })),
    where(Approving._get({ review }).is({ reviewer, status: "withdrawn", requestedAt })),
  ],
).optional();

export const RequestQueuedReview = endpoint(
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

export const ApproveQueuedReview = endpoint(
  "/review-queue/approve",
  ({ review, reviewer, time, alert }) =>
    receive({ review, reviewer })
      .where(Timing._now({}).is({ time }))
      .then(Approving.approve({ review, reviewer, at: time }).responds({ review }))
      .then(
        where(openReviewAlert({ review, reviewer }).is({ alert }))
          .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
          .then(respond({ review, alert }))
          .named("alert-open"),
        where(no(openReviewAlert({ review, reviewer })))
          .then(respond({ error: "REVIEW_ALERT_MISSING" }))
          .named("alert-missing"),
      ),
);

export const RejectQueuedReview = endpoint(
  "/review-queue/reject",
  ({ review, reviewer, reason, time, alert }) =>
    receive({ review, reviewer, reason })
      .where(Timing._now({}).is({ time }))
      .then(Approving.reject({ review, reviewer, reason, at: time }).responds({ review }))
      .then(
        where(openReviewAlert({ review, reviewer }).is({ alert }))
          .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
          .then(respond({ review, alert }))
          .named("alert-open"),
        where(no(openReviewAlert({ review, reviewer })))
          .then(respond({ error: "REVIEW_ALERT_MISSING" }))
          .named("alert-missing"),
      ),
);

export const WithdrawQueuedReview = endpoint(
  "/review-queue/withdraw",
  ({ review, requester, reviewer, time, alert }) =>
    receive({ review, requester })
      .where(Timing._now({}).is({ time }))
      .then(Approving.withdraw({ review, requester, at: time }).responds({ review }))
      .then(
        where(
          Approving._get({ review }).is({ reviewer }),
          openReviewAlert({ review, reviewer }).is({ alert }),
        )
          .then(Alerting.acknowledge({ alert, recipient: reviewer }).responds({ alert }))
          .then(respond({ review, alert }))
          .named("alert-open"),
        where(
          Approving._get({ review }).is({ reviewer }),
          no(openReviewAlert({ review, reviewer })),
        )
          .then(respond({ error: "REVIEW_ALERT_MISSING" }))
          .named("alert-missing"),
      ),
);

export const RepairReviewAlert = endpoint(
  "/review-queue/repair",
  ({ review, reviewer, requestedAt, alert }) =>
    receive({ review }).then(
      where(pendingReviewForRepair({ review }).is({ reviewer, requestedAt }))
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
      where(terminalReviewForRepair({ review }).is({ reviewer, requestedAt }))
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

export const GetReviewQueue = endpoint("/review-queue/get", ({ reviewer }) =>
  receive({ reviewer }).then(respond({ queue: reviewQueue({ reviewer }) })),
);
