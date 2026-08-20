# Message Board

A message board gives authenticated users sessions for publishing posts, commenting, and reading attributed content.

## Application types and instances

```instances
instantiate Authenticating

instantiate Sessioning with
  Subject is Authenticating.Username

instantiate Posting with
  Author is Authenticating.Username

instantiate Commenting with
  Target is Posting.Post
  Author is Authenticating.Username
```

## Compositions

### Accounts

A user may register, sign in, inspect the current account, change its password, sign out, or delete it. Registration and sign-in start a 30-minute session using the causal flow's instant; every later session check receives that same kind of composition-supplied instant. Registration can persist before session creation faults, after which the user can sign in. Deleting an account does not revoke separately owned sessions; they remain usable until ended or expired.

### BoardPublishing

An active session supplies the author for posts and comments, so callers cannot choose another author. A comment may target only an existing Post; a missing target returns `POST_NOT_FOUND` without adding a Comment. Comment retraction uses the same session-derived author.

### BoardPages

An active session may open the board and see posts with their attached comments.

## Views

### PostTargetExists

A comment target exists when Posting can read the referenced Post.

### PostTargetIsMissing

A comment target is missing when Posting cannot read the referenced Post.

## Formers

### MessageBoard

The board read lists posts in publication order and nests each post's comments in arrival order.
