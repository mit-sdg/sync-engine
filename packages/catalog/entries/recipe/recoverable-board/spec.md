# Recoverable Board

A recoverable board publishes and discusses posts, organizes them with labels, and keeps visibility reversible until purge.

## Application types and instances

```types
concrete Person
  An author identity supplied by the board application.

concrete BoardScope
  The fixed labeling scope for this recoverable board.
```

```instances
instantiate Timing

instantiate Posting with
  Author is Person

instantiate Commenting with
  Target is Posting.Post
  Author is Person

instantiate Labeling with
  Scope is BoardScope
  Item is Posting.Post

instantiate Trashing with
  Item is Posting.Post
```

## Compositions

### BoardContent

Authors may publish posts, attach comments to existing posts, and retract their own comments. Public boundaries must derive author identities from authenticated callers.

### BoardLabels

The board may create scoped labels and attach or detach them from existing posts.

### PostRecovery

Trashing hides a post together with its comments and labels; restoring reveals them again. Purging permanently excludes the post from this recipe but does not claim physical deletion from Posting or Commenting storage. Applications requiring erasure need an owner concept with deletion and explicit cross-concept repair.

### BoardPages

Opening the board presents only visible posts with their comments and labels.

## Views

### PostExists

A Post exists when Posting can read its identity.

### PostIsVisible

A Post is visible when it exists and Trashing does not mark it trashed or purged.

### BoardLabel

A board label is a Label owned by the recoverable board's scope.

## Formers

### RecoverableBoard

The board read combines visible Posts with their Comments and attached board Labels.
