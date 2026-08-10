# Message Board recipe

## Purpose

Register and sign in users, publish attributed posts, attach comments, retract one's
own comments, and end access sessions.

## Concepts

Authenticating owns password credentials. Sessioning owns bearer sessions for
Username values used as Subjects. Posting owns Posts. Commenting owns Comments whose
Targets are Post identities. Timing supplies one timestamp for each publication or
comment event.

## Decisions

Registration and successful authentication each start a Session. Protected endpoints
resolve the Session and use its Subject as Author; callers never choose their own
Author. Adding a Comment first confirms that its Post Target exists. Posting has no
removal action, so that observation cannot become stale through a catalog concept
transition.

## Endpoints

- `RegisterBoardUser` — `/message-board/register`
- `SignInBoardUser` — `/message-board/sign-in`
- `CurrentBoardUser` — `/message-board/current-user`
- `SignOutBoardUser` — `/message-board/sign-out`
- `ChangeBoardPassword` — `/message-board/change-password`
- `DeleteBoardAccount` — `/message-board/delete-account`
- `PublishMessageBoardPost` — `/message-board/post`
- `AddMessageBoardComment` — `/message-board/comment`
- `RetractMessageBoardComment` — `/message-board/retract-comment`
- `ListMessageBoard` — `/message-board/list`

## Failure

Credential registration may succeed before session creation faults. The response
reports failure without deleting the Account; the user can sign in. An authenticated
comment request for an unknown Post returns `POST_NOT_FOUND` without adding a Comment.
Deleting an Account does not end any existing Session because Authenticating and
Sessioning have separate owners. Until each Session is ended or expires, it continues
to resolve its Subject and can reach protected recipe operations. Version 1 does not
claim atomic session revocation.

## Host variants

The catalog recipe is transport-neutral. A plain JSON API may carry Session in its
body. A browser host may project Session into a `Secure`, `HttpOnly` cookie. Those are
host policies, not separate recipe entries or concept variants. A public host remains
responsible for runtime input validation, request-rate controls, TLS, and its chosen
session transport.
