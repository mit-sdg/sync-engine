import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Discussing, Timing, Upvoting } = concepts;

const rankedResponses = former(
  "the ranked responses of (discussion)",
  ({ discussion }, { response, author, text, addedAt, score }) =>
    each(Discussing._responses({ discussion }).is({ response, author, text, addedAt }))
      .where(Upvoting._score({ item: response }).is({ score }))
      .form({ response, author, text, addedAt, score }),
);

export const OpenRankedDiscussion = endpoint(
  "/ranked-discussions/open",
  ({ subject, at, discussion }) =>
    receive({ subject })
      .where(Timing._now({}).is({ time: at }))
      .then(Discussing.open({ subject, at }).responds({ discussion }))
      .then(respond({ discussion })),
);

/** A public adapter must bind `author` to the authenticated caller. */
export const RespondToDiscussion = endpoint(
  "/ranked-discussions/respond",
  ({ discussion, author, text, at, response }) =>
    receive({ discussion, author, text })
      .where(Timing._now({}).is({ time: at }))
      .then(Discussing.respond({ discussion, author, text, at }).responds({ response }))
      .then(respond({ response })),
);

/** A public adapter must bind `voter` to the authenticated caller. */
export const UpvoteResponse = endpoint("/ranked-discussions/upvote", ({ response, voter }) =>
  receive({ response, voter }).then(
    where(Discussing._response({ response }))
      .then(Upvoting.upvote({ item: response, voter }).responds({}))
      .then(respond({ response }))
      .named("response-exists"),
    where(no(Discussing._response({ response })))
      .then(respond({ error: "RESPONSE_NOT_FOUND" }))
      .named("response-missing"),
  ),
);

/** A public adapter must bind `voter` to the authenticated caller. */
export const DownvoteResponse = endpoint("/ranked-discussions/downvote", ({ response, voter }) =>
  receive({ response, voter }).then(
    where(Discussing._response({ response }))
      .then(Upvoting.downvote({ item: response, voter }).responds({}))
      .then(respond({ response }))
      .named("response-exists"),
    where(no(Discussing._response({ response })))
      .then(respond({ error: "RESPONSE_NOT_FOUND" }))
      .named("response-missing"),
  ),
);

/** A public adapter must bind `voter` to the authenticated caller. */
export const UnvoteResponse = endpoint("/ranked-discussions/unvote", ({ response, voter }) =>
  receive({ response, voter }).then(
    where(Discussing._response({ response }))
      .then(Upvoting.unvote({ item: response, voter }).responds({}))
      .then(respond({ response }))
      .named("response-exists"),
    where(no(Discussing._response({ response })))
      .then(respond({ error: "RESPONSE_NOT_FOUND" }))
      .named("response-missing"),
  ),
);

export const CloseRankedDiscussion = endpoint("/ranked-discussions/close", ({ discussion, at }) =>
  receive({ discussion })
    .where(Timing._now({}).is({ time: at }))
    .then(Discussing.close({ discussion, at }).responds({ discussion }))
    .then(respond({ discussion })),
);

export const GetRankedDiscussion = endpoint("/ranked-discussions/get", ({ discussion }) =>
  receive({ discussion }).then(respond({ discussion, responses: rankedResponses({ discussion }) })),
);
