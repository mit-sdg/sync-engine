# Recoverable Board recipe

## Purpose

Publish and discuss posts, organize them with labels, and make post visibility
reversible until a permanent purge decision.

## Concepts

Posting owns immutable posts. Commenting owns post comments. Labeling owns board-scoped
labels and post assignments. Trashing owns each Post identity's visibility
disposition. Timing supplies publication, comment, and removal times.

## Decisions

Board reads omit trashed and purged Posts. Trashing a Post hides its Comments and
Labels without deleting them. Restoring reveals them again. Purging permanently
excludes the Post from this recipe. Because Posting deliberately has no delete action,
purge does not claim physical erasure of Post or Comment storage. A public adapter
must bind author inputs to authenticated identities when attribution and author-only
comment retraction matter.

## Endpoints

- `PublishBoardPost` — `/recoverable-board/post`
- `AddBoardComment` — `/recoverable-board/comment`
- `RetractBoardComment` — `/recoverable-board/retract-comment`
- `CreateBoardLabel` — `/recoverable-board/create-label`
- `LabelBoardPost` — `/recoverable-board/label`
- `UnlabelBoardPost` — `/recoverable-board/unlabel`
- `TrashBoardPost` — `/recoverable-board/trash`
- `RestoreBoardPost` — `/recoverable-board/restore`
- `PurgeBoardPost` — `/recoverable-board/purge`
- `ListRecoverableBoard` — `/recoverable-board/list`

## Failure

The visibility decision belongs to Trashing and does not require peer writes. A purge
can be irreversible while peer bytes remain retained. Applications with a physical
erasure requirement need an owner concept that supports deletion and an explicit
repair plan for cross-concept failure.
